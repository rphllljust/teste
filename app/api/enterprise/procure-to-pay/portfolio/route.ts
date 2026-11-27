import {z} from 'zod';
import {databasePool} from '../../../../../db/raw';
import {ApiError,requestContext,respond,failure,type RequestContext} from '../../../../../lib/api/http';
import {classifyProcurePortfolio,sumScaled} from '../../../../../lib/domain/procure-portfolio.mjs';
import {assessProcureDeadlines} from '../../../../../lib/domain/procure-deadlines.mjs';
import {serializeProcurePortfolioCsv} from '../../../../../lib/domain/procure-portfolio-export.mjs';
import type {PoolClient} from 'pg';
export const dynamic='force-dynamic';

const filters=z.object({
 q:z.string().trim().max(90).default(''),
 status:z.enum(['all','draft','approved','received','cancelled']).default('all'),
 page:z.coerce.number().int().min(1).max(10000).default(1),
 format:z.enum(['json','csv']).default('json'),
}).strict();

type Row={
 id:string;reference:string;status:string;expected_on:string|null;created_at:string;
 supplier:string;order_amount:string;
 line_count:number;ordered_qty:string;accepted_qty:string;
 invoice_id:string|null;invoice_amount:string|null;payable_id:string|null;payable_due_on:string|null;
 payable_amount:string|null;paid_amount:string;attributed_amount:string;
 accrual_verified:boolean;unmatched_payments:number;
};
const countSql=[
 'SELECT COUNT(*)::int AS total FROM supplier_purchase_orders po',
 'JOIN suppliers s ON s.id=po.supplier_id AND s.owner_id=po.owner_id',
 'WHERE po.owner_id=$1',
 "AND ($2='' OR po.reference ILIKE ('%'||$2||'%') OR s.legal_name ILIKE ('%'||$2||'%'))",
 "AND ($3='all' OR po.status=$3)",
].join(' ');

/** Paginate the owner-scoped order set BEFORE any lateral financial lookup.
 * All evidence queries share one read-only, repeatable-read PostgreSQL snapshot.
 */
const pageSql=[
 'SELECT po.id,po.reference,po.status,po.expected_on,po.created_at,',
 'po.total::text AS order_amount,po.supplier,',
 'COALESCE(li.line_count,0)::int AS line_count,',
 "COALESCE(li.ordered_qty,'0') AS ordered_qty,COALESCE(li.accepted_qty,'0') AS accepted_qty,",
 'si.id AS invoice_id,si.amount::text AS invoice_amount,p.id AS payable_id,p.due_date AS payable_due_on,',
 'p.amount::text AS payable_amount,COALESCE(pay.paid_amount,0)::text AS paid_amount,',
 'COALESCE(cost.attributed_amount,0)::text AS attributed_amount,',
 'COALESCE(accrual.verified,false) AS accrual_verified,',
 'COALESCE(bank.unmatched_payments,0)::int AS unmatched_payments',
 'FROM (SELECT po.id,po.reference,po.status,po.expected_on,po.created_at,',
 'po.total,po.owner_id,s.legal_name AS supplier',
 'FROM supplier_purchase_orders po',
 'JOIN suppliers s ON s.id=po.supplier_id AND s.owner_id=po.owner_id',
 'WHERE po.owner_id=$1',
 "AND ($2='' OR po.reference ILIKE ('%'||$2||'%') OR s.legal_name ILIKE ('%'||$2||'%'))",
 "AND ($3='all' OR po.status=$3)",
 'ORDER BY po.created_at DESC,po.id DESC LIMIT 25 OFFSET $4) po',
 'LEFT JOIN LATERAL (SELECT COUNT(*)::int AS line_count,',
 'COALESCE(SUM(l.quantity),0)::text AS ordered_qty,',
 'COALESCE(SUM(COALESCE(rec.accepted,0)),0)::text AS accepted_qty',
 'FROM supplier_purchase_order_lines l LEFT JOIN LATERAL (',
 'SELECT COALESCE(SUM(rl.accepted_quantity),0) AS accepted',
 'FROM procurement_receipt_lines rl',
 'JOIN procurement_receipts r ON r.id=rl.receipt_id AND r.owner_id=$1 AND r.order_id=po.id',
 'WHERE rl.order_line_id=l.id) rec ON TRUE',
 'WHERE l.order_id=po.id AND l.owner_id=$1) li ON TRUE',
 'LEFT JOIN LATERAL (SELECT id,amount,payable_id FROM procurement_supplier_invoices',
 'WHERE order_id=po.id AND owner_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1) si ON TRUE',
 'LEFT JOIN payables p ON p.id=si.payable_id AND p.actor_id=$1',
 'LEFT JOIN LATERAL (SELECT COALESCE(SUM(CASE WHEN kind=\'payment\' THEN amount ELSE -amount END),0) AS paid_amount',
 'FROM payable_payments WHERE payable_id=p.id AND actor_id=$1) pay ON TRUE',
 'LEFT JOIN LATERAL (SELECT COALESCE(SUM(CASE WHEN kind=\'allocate\' THEN amount ELSE -amount END),0) AS attributed_amount',
 'FROM enterprise_project_cost_allocations WHERE payable_id=p.id AND actor_id=$1) cost ON TRUE',
 'LEFT JOIN LATERAL (SELECT EXISTS(',
 'SELECT 1 FROM accounting_payable_links al',
 'JOIN journal_entries j ON j.id=al.journal_id AND j.actor_id=$1',
 "WHERE al.payable_id=p.id AND al.actor_id=$1 AND j.status='posted'",
 'AND j.reversal_of IS NULL',
 'AND NOT EXISTS(SELECT 1 FROM journal_entries undo WHERE undo.reversal_of=j.id)',
 ') AS verified) accrual ON TRUE',
 'LEFT JOIN LATERAL (SELECT COUNT(*)::int AS unmatched_payments FROM payable_payments pp',
 "WHERE pp.payable_id=p.id AND pp.actor_id=$1 AND pp.kind='payment' AND NOT EXISTS(",
 'SELECT 1 FROM bank_reconciliation_events e',
 "WHERE e.payment_id=pp.id AND e.actor_id=$1 AND e.kind='match'",
 'AND NOT EXISTS(SELECT 1 FROM bank_reconciliation_events undo',
 'WHERE undo.reverses_id=e.id AND undo.actor_id=$1)',
 ')) bank ON TRUE',
 'ORDER BY po.created_at DESC,po.id DESC'
].join(' ');

export async function GET(request:Request){
 let ctx:RequestContext|undefined;
 let connection:PoolClient|undefined;
 try{
  ctx=requestContext(request);
  const parsed=filters.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Filtros da carteira de compras inválidos.');
  const {q,status,page,format}=parsed.data;
  connection=await databasePool().connect();
  await connection.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const values=[ctx.actorId,q,status];
  const count=await connection.query(countSql,values);
  const records=await connection.query(pageSql,[...values,(page-1)*25]);
  await connection.query('COMMIT');
  const total=Number(count.rows[0]?.total??0);
  const asOf=new Date().toISOString().slice(0,10);
  const items=(records.rows as Row[]).map(row=>{
   const proof=classifyProcurePortfolio({
    status:row.status,lineCount:Number(row.line_count),
    orderedQuantity:row.ordered_qty,acceptedQuantity:row.accepted_qty,
    hasInvoice:!!row.invoice_id,hasPayable:!!row.payable_id,
    orderAmount:row.order_amount,invoiceAmount:row.invoice_amount??'0',
    payableAmount:row.payable_amount??'0',paidAmount:row.paid_amount,
    attributedAmount:row.attributed_amount,
    accrualVerified:row.accrual_verified,unmatchedPayments:Number(row.unmatched_payments)
   });
   const deadlines=assessProcureDeadlines({status:row.status,acceptedQuantity:row.accepted_qty,
    orderedQuantity:row.ordered_qty,expectedOn:row.expected_on,
    payableDueOn:row.payable_due_on,hasPayable:!!row.payable_id,
    outstandingScaled:proof.outstandingScaled},{today:asOf});
   return {id:row.id,reference:row.reference,supplier:row.supplier,
    status:row.status,expectedOn:row.expected_on,payableDueOn:row.payable_due_on,
    createdAt:row.created_at,
    invoiceId:row.invoice_id,payableId:row.payable_id,
    orderedQuantity:row.ordered_qty,acceptedQuantity:row.accepted_qty,
    accrualVerified:row.accrual_verified,unmatchedPayments:Number(row.unmatched_payments),
    ...proof,...deadlines};
  });
  if(format==='csv'){
   const csv=serializeProcurePortfolioCsv(items);
   return new Response(csv,{status:200,headers:{
    'Content-Type':'text/csv; charset=utf-8',
    'Content-Disposition':`attachment; filename="cisne-carteira-compras-pagina-${page}.csv"`,
    'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'
   }});
  }
  return respond({
   items,pageInfo:{page,pageSize:25,total,hasMore:page*25<total},
   summary:{
    pageOrders:items.length,pageDocumentExceptions:items.filter(x=>x.flags.length>0).length,
    pageDeliveryOverdue:items.filter(x=>x.delivery.state==='overdue').length,
    pagePaymentOverdue:items.filter(x=>x.payment.state==='overdue').length,
    pagePurchaseScaled:sumScaled(items.map(x=>x.orderScaled)),
    pageOutstandingScaled:sumScaled(items.map(x=>x.outstandingScaled)),
    pageAttributedScaled:sumScaled(items.map(x=>x.attributedScaled))
   },
   source:'owner_scoped_postgresql_documentary_evidence',
   consistency:'REPEATABLE READ READ ONLY',
   warnings:[
    'Valores consolidados e exportação CSV referem-se apenas aos pedidos exibidos nesta página.',
    'Alertas de entrega e vencimento financeiro são independentes e usam a data civil UTC; não significam juros, liquidação nem lançamento contábil.',
    'Recebimento usa quantidades aceitas; não substitui a conferência individual de estoque.',
    'Reconhecimento contábil e conciliações bancárias só são considerados mediante vínculo persistido e válido.',
    'Não representa caixa disponível, fechamento fiscal, margem total ou transmissão bancária.'
   ],
   generatedAt:new Date().toISOString(),
  },ctx);
 }catch(error){
  if(connection){try{await connection.query('ROLLBACK')}catch{/* preserve original error */}}
  return failure(error,ctx);
 }finally{connection?.release();}
}
