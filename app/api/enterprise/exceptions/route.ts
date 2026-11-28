import {z} from 'zod';
import {database} from '../../../../db/raw';
import {ApiError,failure,requestContext,respond,validDate,type RequestContext} from '../../../../lib/api/http';
import {payableBalance} from '../../../../lib/projections/payables';
import {outstandingExpression} from '../../../../lib/projections/operation';

export const dynamic='force-dynamic';
const category=z.enum(['all','procurement','operations','measurements','billing','accounting','receivables','payables','treasury']);
const filters=z.object({category:category.default('all'),
 page:z.coerce.number().int().min(1).max(10000).default(1),
 asOf:z.string().refine(validDate).optional()}).strict();
/** Every exception has a persisted owner-scoped source and a destination.
 * It is a read model: identifying a gap never initiates a business transaction.
 */
const source=[
 'WITH events AS (',
 "SELECT 'procurement'::text category,'PURCHASE_ORDER_LATE'::text code,'warning'::text severity,",
 "po.id AS entity_id,NULL::text AS order_id,po.reference AS title,'Compras'::text module,",
 'po.expected_on AS reference_date,po.total::text AS amount_scaled',
 'FROM supplier_purchase_orders po WHERE po.owner_id=$1 AND po.status=\'approved\' AND po.expected_on<$2',
 'UNION ALL',
 "SELECT 'operations','COMPLETED_WITHOUT_MEASUREMENT','warning',o.id,o.id,o.title,'Ordens de serviço',",
 "COALESCE(o.due_date,LEFT(o.created_at,10)),'0'::text FROM service_orders o",
 "WHERE o.owner_id=$1 AND o.status='completed' AND NOT EXISTS",
 '(SELECT 1 FROM measurements m WHERE m.order_id=o.id AND m.status<>\'cancelled\')',
 'UNION ALL',
 "SELECT 'measurements','MEASUREMENT_PENDING_APPROVAL','warning',m.id,o.id,m.description,'Medições',",
 'LEFT(m.created_at,10),m.amount::text FROM measurements m',
 'JOIN service_orders o ON o.id=m.order_id AND o.owner_id=$1',
 "WHERE m.status IN ('draft','submitted')",
 'UNION ALL',
 "SELECT 'operations','EXECUTION_NOT_MEASURED','warning',e.id,o.id,",
 "('Execução '||e.reference),'Execução',e.effective_date,'0'::text",
 'FROM execution_entries e JOIN service_orders o ON o.id=e.order_id AND o.owner_id=$1',
 "WHERE o.status='completed' AND e.kind='report'",
 'AND NOT EXISTS(SELECT 1 FROM execution_entries undo WHERE undo.reverses_id=e.id)',
 "AND NOT EXISTS(SELECT 1 FROM measurements m WHERE m.execution_entry_id=e.id AND m.status<>'cancelled')",
 'UNION ALL',
 "SELECT 'measurements','APPROVED_UNBILLED','warning',m.id,o.id,m.description,'Medições',",
 'LEFT(m.created_at,10),m.amount::text FROM measurements m',
 'JOIN service_orders o ON o.id=m.order_id AND o.owner_id=$1',
 "WHERE m.status='approved' AND NOT EXISTS(SELECT 1 FROM invoices i WHERE i.measurement_id=m.id)",
 'UNION ALL',
 "SELECT 'billing','INVOICE_WITHOUT_RECEIVABLE','critical',i.id,o.id,",
 "('Fatura '||LEFT(i.id,8)),'Faturamento',LEFT(i.created_at,10),i.amount::text",
 'FROM invoices i JOIN service_orders o ON o.id=i.order_id AND o.owner_id=$1',
 'WHERE NOT EXISTS(SELECT 1 FROM receivables r WHERE r.invoice_id=i.id)',
 'UNION ALL',
 "SELECT 'accounting','INVOICE_JOURNAL_UNVERIFIED','warning',i.id,o.id,",
 "('Fatura '||LEFT(i.id,8)),'Contabilidade',LEFT(i.created_at,10),i.amount::text",
 'FROM invoices i JOIN service_orders o ON o.id=i.order_id AND o.owner_id=$1',
 'LEFT JOIN accounting_invoice_links l ON l.invoice_id=i.id AND l.actor_id=$1',
 'LEFT JOIN journal_entries j ON j.id=l.journal_id AND j.actor_id=$1',
 'WHERE NOT COALESCE((l.id IS NOT NULL AND l.amount=i.amount',
 "AND j.status='posted' AND j.reversal_of IS NULL",
 'AND NOT EXISTS(SELECT 1 FROM journal_entries rev WHERE rev.reversal_of=j.id)',
 'AND (SELECT COALESCE(SUM(debit),0) FROM journal_lines jl WHERE jl.entry_id=j.id)=i.amount',
 'AND (SELECT COALESCE(SUM(credit),0) FROM journal_lines jl WHERE jl.entry_id=j.id)=i.amount),FALSE)',
 'UNION ALL',
 "SELECT 'receivables','RECEIVABLE_OVERDUE','warning',r.id,o.id,",
 "('Recebível '||LEFT(r.id,8)),'Financeiro',r.due_date,("+outstandingExpression+")::text",
 'FROM receivables r JOIN invoices i ON i.id=r.invoice_id',
 'JOIN service_orders o ON o.id=i.order_id AND o.owner_id=$1',
 "WHERE r.due_date<$2 AND ("+outstandingExpression+")>0",
 'UNION ALL',
 "SELECT 'payables','PAYABLE_OVERDUE','warning',p.id,NULL::text,p.supplier,",
 "'Contas a pagar',p.due_date,("+payableBalance+")::text FROM payables p",
 "WHERE p.actor_id=$1 AND p.due_date<$2 AND ("+payableBalance+")>0",
 'UNION ALL',
 "SELECT 'accounting','PAYABLE_GL_UNVERIFIED','warning',p.id,NULL::text,",
 "('Obrigação '||LEFT(p.id,8)),'Contabilidade',LEFT(p.created_at,10),p.amount::text",
 'FROM payables p LEFT JOIN accounting_payable_links l ON l.payable_id=p.id AND l.actor_id=p.actor_id',
 'LEFT JOIN journal_entries j ON j.id=l.journal_id AND j.actor_id=p.actor_id',
 'WHERE p.actor_id=$1 AND NOT COALESCE((l.id IS NOT NULL AND l.amount=p.amount',
 "AND j.status='posted' AND j.reversal_of IS NULL",
 'AND NOT EXISTS(SELECT 1 FROM journal_entries rev WHERE rev.reversal_of=j.id)',
 'AND (SELECT COALESCE(SUM(debit),0) FROM journal_lines WHERE entry_id=j.id)=p.amount',
 'AND (SELECT COALESCE(SUM(credit),0) FROM journal_lines WHERE entry_id=j.id)=p.amount),FALSE)',
 'UNION ALL',
 "SELECT 'accounting','PAYMENT_GL_UNVERIFIED','warning',e.id,NULL::text,",
 "('Baixa fornecedor '||LEFT(e.id,8)),'Contabilidade',e.effective_date,e.amount::text",
 'FROM payable_payments e JOIN payables p ON p.id=e.payable_id AND p.actor_id=$1',
 'LEFT JOIN accounting_payable_payment_links l ON l.payment_id=e.id AND l.actor_id=p.actor_id',
 'LEFT JOIN journal_entries j ON j.id=l.journal_id AND j.actor_id=p.actor_id',
 'WHERE NOT COALESCE((l.id IS NOT NULL AND l.amount=e.amount AND l.kind=e.kind',
 'AND l.effective_date=e.effective_date AND j.effective_date=e.effective_date',
 "AND j.status='posted'",
 'AND (SELECT COALESCE(SUM(debit),0) FROM journal_lines WHERE entry_id=j.id)=e.amount',
 'AND (SELECT COALESCE(SUM(credit),0) FROM journal_lines WHERE entry_id=j.id)=e.amount),FALSE)',
 'UNION ALL',
 "SELECT 'accounting','RECEIPT_GL_UNVERIFIED','warning',s.id,o.id,",
 "('Baixa recebível '||LEFT(s.id,8)),'Contabilidade',s.effective_date,s.amount::text",
 'FROM receivable_settlements s JOIN receivables r ON r.id=s.receivable_id',
 'JOIN invoices i ON i.id=r.invoice_id JOIN service_orders o ON o.id=i.order_id AND o.owner_id=$1',
 'LEFT JOIN accounting_settlement_links l ON l.settlement_id=s.id AND l.actor_id=o.owner_id',
 'LEFT JOIN journal_entries j ON j.id=l.journal_id AND j.actor_id=o.owner_id',
 'WHERE NOT COALESCE((l.id IS NOT NULL AND l.kind=s.kind AND l.amount=s.amount',
 'AND l.effective_date=s.effective_date AND j.effective_date=s.effective_date',
 "AND j.status='posted'",
 'AND (SELECT COALESCE(SUM(debit),0) FROM journal_lines WHERE entry_id=j.id)=s.amount',
 'AND (SELECT COALESCE(SUM(credit),0) FROM journal_lines WHERE entry_id=j.id)=s.amount),FALSE)',
 'UNION ALL',
 "SELECT 'treasury','BANK_LINE_UNMATCHED','warning',l.id,NULL::text,",
 "(s.account_reference||' · '||l.description),'Caixa e conciliação',l.booked_date,l.amount::text",
 'FROM bank_statement_lines l JOIN bank_statements s ON s.id=l.statement_id AND s.actor_id=$1',
 'WHERE NOT EXISTS (SELECT 1 FROM bank_reconciliation_events m',
 "WHERE m.line_id=l.id AND m.actor_id=$1 AND m.kind='match'",
 'AND NOT EXISTS(SELECT 1 FROM bank_reconciliation_events u WHERE u.reverses_id=m.id))',
 ')'
].join(' ');

type CategoryRow={category:string;total:number};
type ExceptionRow={category:string;code:string;severity:string;entity_id:string;order_id:string|null;
 title:string;module:string;reference_date:string;amount_scaled:string};

export async function GET(request:Request){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request);
  const parsed=filters.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Filtros do centro de exceções inválidos.');
  const f=parsed.data,asOf=f.asOf??new Date().toISOString().slice(0,10);
  const data=await database().transaction(async q=>{
   await q('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const counts=await q(source+' SELECT category,COUNT(*)::int AS total FROM events GROUP BY category ORDER BY category',
    [ctx!.actorId,asOf]);
   const page=await q(source+' SELECT category,code,severity,entity_id,order_id,title,module,'+
    'reference_date,amount_scaled FROM events WHERE ($3=\'all\' OR category=$3) '+
    "ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END,reference_date ASC NULLS LAST,"+
    'category,entity_id LIMIT $4 OFFSET $5',
    [ctx!.actorId,asOf,f.category,26,(f.page-1)*25]);
   return {counts:counts.rows as CategoryRow[],rows:page.rows as ExceptionRow[]};
  });
  const counts=data.counts.map(row=>({category:row.category,total:Number(row.total)}));
  const total=f.category==='all'?counts.reduce((n,r)=>n+r.total,0):
   counts.find(r=>r.category===f.category)?.total??0;
  return respond({
   asOf,items:data.rows.slice(0,25).map(row=>({
    category:row.category,code:row.code,severity:row.severity,id:row.entity_id,
    orderId:row.order_id,title:row.title,module:row.module,date:row.reference_date,
    amountScaled:row.amount_scaled,
   })),
   summary:{total,allOpen:counts.reduce((n,r)=>n+r.total,0),byCategory:counts},
   pageInfo:{page:f.page,pageSize:25,total,hasMore:f.page*25<total},
   scope:'authenticated_owner',source:'persisted_operational_finance_accounting_and_bank_facts',
   warnings:['Fila de exceções documental: vínculos sem diário válido impedem certificação contábil Tier 1 e precisam de regularização autorizada.',
    'Os registros financeiros usam saldos atuais por vencimento. Não reconstituem posições históricas.',
    'A fila encaminha ao módulo responsável, sem executar comandos nem aprovar exceções automaticamente.'],
   generatedAt:new Date().toISOString(),
  },ctx);
 }catch(error){return failure(error,ctx);}
}
