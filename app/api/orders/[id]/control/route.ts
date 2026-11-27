import {z} from 'zod';
import type {PoolClient} from 'pg';
import {databasePool} from '../../../../../db/raw';
import {ApiError,requestContext,respond,failure,type RequestContext} from '../../../../../lib/api/http';
import {deriveServiceOrderControl} from '../../../../../lib/domain/service-order-control.mjs';

export const dynamic='force-dynamic';
const uuid=z.string().uuid();
type Row=Record<string,unknown>;
const n=(row:Row|undefined,key:string)=>Number(row?.[key]??0);
const str=(row:Row|undefined,key:string)=>String(row?.[key]??'0');
/** A read-only, owner-scoped control plane. All nine facts share one MVCC snapshot.
 * No posting, allocation, approval or lifecycle transition is performed here.
 */
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 let ctx:RequestContext|undefined;
 let client:PoolClient|undefined;
 try{
  ctx=requestContext(request);
  const id=(await params).id;
  if(!uuid.safeParse(id).success)throw new ApiError(400,'VALIDATION_FAILED','Identificador de OS inválido.');
  client=await databasePool().connect();
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const order=(await client.query(
   'SELECT id,title,client,status,version,category,contract_id,due_date,created_at FROM service_orders WHERE id=$1 AND owner_id=$2',
   [id,ctx.actorId])).rows[0] as Row|undefined;
  if(!order)throw new ApiError(404,'NOT_FOUND','Ordem de serviço não encontrada neste contexto.');
  const allocations=(await client.query(
   `SELECT COUNT(*) FILTER(WHERE status='active')::int AS active,
     COUNT(*) FILTER(WHERE status='released')::int AS released,
     COUNT(*) FILTER(WHERE status='active' AND ends_at<now())::int AS ended,
     MIN(starts_at) FILTER(WHERE status='active') AS next_start
    FROM resource_allocations WHERE order_id=$1 AND owner_id=$2`,[id,ctx.actorId])).rows[0] as Row;
  const execution=(await client.query(
   `SELECT
     COUNT(*) FILTER(WHERE e.kind='report' AND NOT EXISTS(
       SELECT 1 FROM execution_entries undo WHERE undo.reverses_id=e.id))::int AS active,
     COUNT(*) FILTER(WHERE e.kind='void')::int AS reversed,
     COUNT(*) FILTER(WHERE e.kind='report' AND NOT EXISTS(
       SELECT 1 FROM execution_entries undo WHERE undo.reverses_id=e.id)
       AND NOT EXISTS(SELECT 1 FROM measurements m
         WHERE m.execution_entry_id=e.id AND m.status<>'cancelled'))::int AS unmeasured
    FROM execution_entries e WHERE e.order_id=$1`,[id])).rows[0] as Row;
  const measures=(await client.query(
   `SELECT COUNT(*)::int AS total,
     COUNT(*) FILTER(WHERE status='draft')::int AS draft,
     COUNT(*) FILTER(WHERE status='submitted')::int AS submitted,
     COUNT(*) FILTER(WHERE status='approved')::int AS approved,
     COUNT(*) FILTER(WHERE status='billed')::int AS billed,
     COUNT(*) FILTER(WHERE status='cancelled')::int AS cancelled,
     COUNT(*) FILTER(WHERE status='approved' AND NOT EXISTS(
       SELECT 1 FROM invoices i WHERE i.measurement_id=m.id AND i.order_id=$1))::int AS approved_unbilled
    FROM measurements m WHERE m.order_id=$1`,[id])).rows[0] as Row;
  const invoice=(await client.query(
   `SELECT COUNT(*)::int AS total,COALESCE(SUM(i.amount::bigint),0)::text AS billed_scaled,
     COUNT(*) FILTER(WHERE NOT EXISTS(
       SELECT 1 FROM receivables r WHERE r.invoice_id=i.id))::int AS missing_receivable,
     COUNT(*) FILTER(WHERE NOT EXISTS(
       SELECT 1 FROM accounting_invoice_links ail
       JOIN journal_entries j ON j.id=ail.journal_id AND j.actor_id=$2
       WHERE ail.invoice_id=i.id AND ail.actor_id=$2 AND j.status='posted'
         AND j.reversal_of IS NULL
         AND NOT EXISTS(SELECT 1 FROM journal_entries undo WHERE undo.reversal_of=j.id)
     ))::int AS unverified_posting
    FROM invoices i WHERE i.order_id=$1`,[id,ctx.actorId])).rows[0] as Row;
  const collection=(await client.query(
   `SELECT COALESCE(SUM(CASE WHEN s.kind='receipt' THEN s.amount::bigint
     ELSE -s.amount::bigint END),0)::text AS settled_scaled,
     COUNT(*) FILTER(WHERE s.kind='receipt' AND NOT EXISTS(
       SELECT 1 FROM bank_reconciliation_events e
       WHERE e.receipt_id=s.id AND e.actor_id=$2 AND e.kind='match'
         AND NOT EXISTS(SELECT 1 FROM bank_reconciliation_events undo
           WHERE undo.reverses_id=e.id AND undo.actor_id=$2)
     ))::int AS unmatched_receipts
    FROM receivable_settlements s
    JOIN receivables r ON r.id=s.receivable_id
    JOIN invoices i ON i.id=r.invoice_id
    WHERE i.order_id=$1 AND s.actor_id=$2`,[id,ctx.actorId])).rows[0] as Row;
  const costs=(await client.query(
   `SELECT COALESCE(SUM(CASE WHEN kind='allocate' THEN amount::bigint
     ELSE -amount::bigint END),0)::text AS cost_scaled,
     COUNT(*) FILTER(WHERE kind='allocate')::int AS allocations,
     COUNT(*) FILTER(WHERE kind='reverse')::int AS reversals
    FROM enterprise_project_cost_allocations
    WHERE service_order_id=$1 AND actor_id=$2`,[id,ctx.actorId])).rows[0] as Row;
  await client.query('COMMIT');
  const asOf=new Date().toISOString().slice(0,10);
  const control=deriveServiceOrderControl({
   status:order.status,dueDate:order.due_date,
   activeAllocations:n(allocations,'active'),activeExecutions:n(execution,'active'),
   unmeasuredExecutions:n(execution,'unmeasured'),measurements:n(measures,'total'),
   measurementSubmitted:n(measures,'submitted'),
   approvedUnbilled:n(measures,'approved_unbilled'),invoices:n(invoice,'total'),
   invoicesWithoutReceivable:n(invoice,'missing_receivable'),
   invoicedWithoutPosting:n(invoice,'unverified_posting'),
   unmatchedReceipts:n(collection,'unmatched_receipts'),
   billedScaled:str(invoice,'billed_scaled'),
   settledScaled:str(collection,'settled_scaled'),costScaled:str(costs,'cost_scaled')
  },{asOf});
  return respond({
   order:{id:String(order.id),title:String(order.title),client:String(order.client),
    status:String(order.status),version:Number(order.version),category:String(order.category),
    contractId:order.contract_id?String(order.contract_id):null,
    dueDate:order.due_date?String(order.due_date).slice(0,10):null},
   ...control,
   evidence:{
    resources:{active:n(allocations,'active'),released:n(allocations,'released'),
     elapsedActive:n(allocations,'ended'),firstActiveStart:allocations.next_start??null},
    execution:{active:n(execution,'active'),reversed:n(execution,'reversed'),
     pendingMeasurement:n(execution,'unmeasured')},
    measurements:{total:n(measures,'total'),draft:n(measures,'draft'),
     submitted:n(measures,'submitted'),approved:n(measures,'approved'),
     billed:n(measures,'billed'),cancelled:n(measures,'cancelled'),
     approvedUnbilled:n(measures,'approved_unbilled')},
    billing:{invoices:n(invoice,'total'),
     withoutReceivable:n(invoice,'missing_receivable'),withoutVerifiedPosting:n(invoice,'unverified_posting')},
    bank:{receiptsWithoutActiveMatch:n(collection,'unmatched_receipts')},
    costs:{allocationEvents:n(costs,'allocations'),reversalEvents:n(costs,'reversals')}
   },
   source:'owned_pg_service_order_control_snapshot',consistency:'REPEATABLE READ READ ONLY',
   warnings:[
    'Pendências são alertas documentais, não autorizações automáticas de comandos ou fechamento.',
    'Contribuição parcial = faturamento nominal menos custos diretamente atribuídos; não representa margem, lucro ou competência contábil.',
    'Recebimento financeiro não equivale a conciliação bancária ou disponibilidade de caixa.',
    'A inexistência de alocação registrada não comprova ausência física de equipe ou equipamentos.'
   ],
   generatedAt:new Date().toISOString()
  },ctx);
 }catch(error){
  if(client){try{await client.query('ROLLBACK')}catch{/* Original error preserved */}}
  return failure(error,ctx);
 }finally{client?.release();}
}
