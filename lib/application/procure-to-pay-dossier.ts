import {databasePool} from '../../db/raw';
import {ApiError} from '../api/http';
import {classifyProcureToPay,buildProcureToPayTotals} from '../domain/procure-to-pay-status.mjs';
import type {PoolClient} from 'pg';
type Row=Record<string,unknown>;
const txt=(v:unknown)=>v==null?'':String(v);
const n=(v:unknown)=>Number(v??0);
const stage=(key:string,title:string,state:'linked'|'pending'|'exception',items:Row[],module:string)=>({
 key,title,state,module,items:items.slice(0,50).map(v=>({
  id:txt(v.id),reference:txt(v.reference??v.document_number??v.source_reference??v.id),
  state:txt(v.status??v.kind??'documentado'),createdAt:v.created_at?txt(v.created_at):null,
  amountScaled:v.amount!=null?txt(v.amount):undefined
 })),truncated:items.length>50
});
/** An immutable, actor-scoped read model of persisted procurement/AP/GL/bank facts.
 * Not an approval or settlement service. All queries run under one repeatable-read snapshot.
 * A missing posting or match remains unverified, never counted as completed.
 */
export async function getProcureToPayDossier(actorId:string,orderId:string){
 const db:PoolClient=await databasePool().connect();
 try{
  await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const read=async(sql:string,values:unknown[]=[])=> (await db.query(sql,values)).rows as Row[];
  const order=(await read(
   'SELECT po.id,po.reference,po.total,po.status,po.created_at,po.expected_on,po.supplier_id,'+
   's.legal_name AS supplier,s.status AS supplier_status '+
   'FROM supplier_purchase_orders po JOIN suppliers s ON s.id=po.supplier_id AND s.owner_id=po.owner_id '+
   'WHERE po.id=$1 AND po.owner_id=$2 LIMIT 1',[orderId,actorId]))[0];
  if(!order)throw new ApiError(404,'NOT_FOUND','Pedido de compra indisponível neste contexto.');
  const lines=await read(
   'SELECT l.id,l.position,l.quantity,l.subtotal,l.item_id,i.sku,i.name,'+
    'COALESCE((SELECT SUM(rl.accepted_quantity) FROM procurement_receipt_lines rl '+
    'JOIN procurement_receipts r ON r.id=rl.receipt_id AND r.owner_id=$2 '+
    'WHERE rl.order_line_id=l.id AND r.order_id=$1),0)::text AS accepted,'+
    'COALESCE((SELECT SUM(rl.rejected_quantity) FROM procurement_receipt_lines rl '+
    'JOIN procurement_receipts r ON r.id=rl.receipt_id AND r.owner_id=$2 '+
    'WHERE rl.order_line_id=l.id AND r.order_id=$1),0)::text AS rejected,'+
    'COALESCE((SELECT SUM(im.delta) FROM inventory_movements im '+
    'WHERE im.procurement_order_id=$1 AND im.owner_id=$2 AND im.item_id=l.item_id '+
    'AND im.procurement_receipt_line_id IN (SELECT rl.id FROM procurement_receipt_lines rl '+
     'JOIN procurement_receipts r ON r.id=rl.receipt_id '+
     'WHERE rl.order_line_id=l.id AND r.order_id=$1 AND r.owner_id=$2)),0)::text AS stock_delta '+
   'FROM supplier_purchase_order_lines l JOIN inventory_items i ON i.id=l.item_id AND i.owner_id=l.owner_id '+
   'WHERE l.order_id=$1 AND l.owner_id=$2 ORDER BY l.position,l.id',[orderId,actorId]);
  const receipts=await read(
   'SELECT id,reference,created_at FROM procurement_receipts WHERE order_id=$1 AND owner_id=$2 '+
   'ORDER BY created_at DESC,id DESC LIMIT 51',[orderId,actorId]);
  const invoice=(await read('SELECT si.id,si.document_number,si.issue_date,si.due_date,si.amount,si.status,'+
   'si.created_at,si.payable_id FROM procurement_supplier_invoices si '+
   'WHERE si.order_id=$1 AND si.owner_id=$2 LIMIT 1',[orderId,actorId]))[0];
  const payable=invoice?(await read(
   'SELECT p.id,p.supplier,p.source_reference,p.amount,p.due_date,p.created_at FROM payables p '+
   'WHERE p.id=$1 AND p.actor_id=$2 LIMIT 1',[invoice.payable_id,actorId]))[0]:undefined;
  const payments=payable?await read(
   'SELECT id,kind,amount::text AS "amountScaled",effective_date,reference,created_at '+
   'FROM payable_payments WHERE payable_id=$1 AND actor_id=$2 ORDER BY created_at DESC,id DESC',
   [payable.id,actorId]):[];
  const accrual=payable?(await read(
   'SELECT al.id,al.journal_id AS "journalId",al.amount,j.status,j.effective_date,'+
   '(j.status=\'posted\' AND j.reversal_of IS NULL AND NOT EXISTS('+
    'SELECT 1 FROM journal_entries undo WHERE undo.reversal_of=j.id)) AS verified '+
   'FROM accounting_payable_links al JOIN journal_entries j ON j.id=al.journal_id AND j.actor_id=al.actor_id '+
   'WHERE al.payable_id=$1 AND al.actor_id=$2 LIMIT 1',[payable.id,actorId]))[0]:undefined;
  const paymentPostings=payable?await read(
   'SELECT l.payment_id,j.id AS journal_id,j.status,'+
   '(j.status=\'posted\' AND (j.reversal_of IS NOT NULL OR NOT EXISTS('+
    'SELECT 1 FROM journal_entries undo WHERE undo.reversal_of=j.id))) AS verified '+
   'FROM accounting_payable_payment_links l '+
   'JOIN payable_payments p ON p.id=l.payment_id AND p.actor_id=l.actor_id '+
   'JOIN journal_entries j ON j.id=l.journal_id AND j.actor_id=l.actor_id '+
   'WHERE p.payable_id=$1 AND p.actor_id=$2',[payable.id,actorId]):[];
  const bankMatches=payable?await read(
   "SELECT e.id,e.payment_id AS payment_id,e.created_at,bs.source_reference AS reference "+
   'FROM bank_reconciliation_events e '+
   'JOIN payable_payments pay ON pay.id=e.payment_id AND pay.actor_id=e.actor_id '+
   'JOIN bank_statement_lines line ON line.id=e.line_id '+
   'JOIN bank_statements bs ON bs.id=line.statement_id AND bs.actor_id=e.actor_id '+
   "WHERE pay.payable_id=$1 AND e.actor_id=$2 AND e.kind='match' "+
   'AND NOT EXISTS(SELECT 1 FROM bank_reconciliation_events undo WHERE undo.reverses_id=e.id) '+
   'ORDER BY e.created_at DESC,e.id DESC LIMIT 51',[payable.id,actorId]):[];
  const costs=payable?await read(
   "SELECT a.id,a.service_order_id AS order_id,o.title AS reference,a.kind,a.amount::text AS amount,"+
   'a.created_at FROM enterprise_project_cost_allocations a '+
   'JOIN service_orders o ON o.id=a.service_order_id AND o.owner_id=a.actor_id '+
   'WHERE a.payable_id=$1 AND a.actor_id=$2 ORDER BY a.created_at DESC,a.id DESC LIMIT 51',
   [payable.id,actorId]):[];
  const costTotals=payable?await read(
   "SELECT COALESCE(SUM(CASE WHEN kind='allocate' THEN amount::bigint ELSE -amount::bigint END),0)::text AS total "+
   'FROM enterprise_project_cost_allocations WHERE payable_id=$1 AND actor_id=$2',[payable.id,actorId]):[];
  await db.query('COMMIT');
  const totals=buildProcureToPayTotals({
   orderAmount:order.total,invoiceAmount:invoice?.amount??0,payableAmount:payable?.amount??0,
   payments,allocated:costTotals[0]?.total??0
  });
  const lineCount=lines.length;
  const unreceivedCount=lines.filter(l=>BigInt(txt(l.accepted))<BigInt(txt(l.quantity))||BigInt(txt(l.rejected))>0n).length;
  const inventoryMismatchCount=lines.filter(l=>BigInt(txt(l.accepted))!==BigInt(txt(l.stock_delta))).length;
  const postings=new Map(paymentPostings.map(row=>[txt(row.payment_id),row]));
  const matches=new Set(bankMatches.map(row=>txt(row.payment_id)));
  const warnings=classifyProcureToPay({
   lineCount,unreceivedCount,inventoryMismatchCount,orderStatus:order.status,
   hasInvoice:!!invoice,hasPayable:!!payable,
   invoiceAmount:invoice?.amount==null?'0':txt(invoice.amount),
   payableAmount:payable?.amount==null?'0':txt(payable.amount),
   accrualVerified:accrual?.verified===true,
   paymentCount:payments.length,
   unpostedPaymentCount:payments.filter(p=>postings.get(txt(p.id))?.verified!==true).length,
   unmatchedPaymentCount:payments.filter(p=>p.kind==='payment'&&!matches.has(txt(p.id))).length,
   outstandingScaled:totals.outstandingScaled
  });
  const status=(present:boolean,verified=true):'linked'|'pending'|'exception'=>present?(verified?'linked':'exception'):'pending';
  return {order:{id:txt(order.id),reference:txt(order.reference),supplier:txt(order.supplier),
   status:txt(order.status),expectedOn:txt(order.expected_on),createdAt:txt(order.created_at)},
   stages:[
    stage('purchase','Pedido aprovado',status(true,order.status!=='cancelled'),[order],'Compras'),
    stage('receipt','Recebimento e estoque',status(receipts.length>0,unreceivedCount===0&&inventoryMismatchCount===0),receipts,'Estoque e compras'),
    stage('supplierDocument','Conciliação três vias',status(!!invoice,!!payable&&txt(invoice?.amount)===txt(payable?.amount)),invoice?[{...invoice,reference:invoice.document_number}]:[],'Compras'),
    stage('payable','Obrigação financeira',status(!!payable),payable?[{...payable,reference:payable.source_reference}]:[],'Contas a pagar'),
    stage('payments','Pagamentos e estornos',status(payments.length>0),payments.map(v=>({...v,amount:v.amountScaled})),'Contas a pagar'),
    stage('accrual','Reconhecimento contábil',status(!!accrual,accrual?.verified===true),accrual?[{...accrual,id:accrual.journalId,reference:'Diário de reconhecimento'}]:[],'Contabilidade'),
    stage('paymentJournals','Diários de pagamentos',status(paymentPostings.length>0,
      payments.every(v=>postings.get(txt(v.id))?.verified===true)),paymentPostings.map(p=>({...p,id:p.journal_id,reference:'Diário de baixa'})),'Contabilidade'),
    stage('bank','Conciliações bancárias',status(bankMatches.length>0),bankMatches,'Caixa e conciliação'),
    stage('projectCost','Custo atribuído a OS',status(costs.length>0),costs,'Controladoria')
   ],financials:totals,
   checks:{lineCount,unreceivedCount,inventoryMismatchCount,
    paymentCount:payments.length,accrualVerified:accrual?.verified===true,
    bankMatches:bankMatches.length,attributionRows:costs.length},
   payableId:payable?txt(payable.id):null,
   documentNumber:invoice?txt(invoice.document_number):null,
   alerts:warnings,
   provenance:{source:'postgres_owner_scoped_repeatable_read',readOnly:true,actorScoped:true,
    constraints:['Documentos vinculados não equivalem a operação aprovada ou encerrada.',
      'Conciliação bancária requer evento match ainda não estornado; caixa disponível não é inferido.',
      'Custo atribuído não prova escrituração, margem total, folha ou transmissão fiscal.']},
   generatedAt:new Date().toISOString()
  };
 }catch(error){try{await db.query('ROLLBACK')}catch{/* preserve original error */}throw error;
 }finally{db.release()}
}
