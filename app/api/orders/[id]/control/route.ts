import {z} from 'zod';
import type {PoolClient} from 'pg';
import {databasePool} from '../../../../../db/raw';
import {ApiError,failure,requestContext,respond,type RequestContext} from '../../../../../lib/api/http';
import {assessServiceOrderControl} from '../../../../../lib/domain/service-order-control.mjs';

export const dynamic='force-dynamic';
const uuid=z.string().uuid();
type Row=Record<string,unknown>;
const asCount=(v:unknown)=>Number(v??0);
const asMoney=(v:unknown)=>String(v??'0');

/**
 * Enterprise OS control dossier from one owner-scoped PostgreSQL snapshot.
 * No command, forecast, inferred cash receipt, cost accrual or GL posting.
 * All related facts are retrieved AFTER the owning order is proven.
 */
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 let context:RequestContext|undefined;
 let client:PoolClient|undefined;
 try{
  context=requestContext(request);
  const {id}=await params;
  if(!uuid.safeParse(id).success)throw new ApiError(400,'VALIDATION_FAILED','Ordem de serviço inválida.');
  client=await databasePool().connect();
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const owner=context.actorId;
  const order=(await client.query<Row>(
   'SELECT id,title,client,category,status,version,description,created_at,due_date,client_id,contract_id FROM service_orders WHERE id=$1 AND owner_id=$2 LIMIT 1',
   [id,owner])).rows[0];
  if(!order)throw new ApiError(404,'NOT_FOUND','Ordem de serviço não encontrada.');
  // The join anchor is always the authorized order; related objects never
  // become directly addressable solely because their IDs appear in a URL.
  const resource=(await client.query<Row>(`SELECT
   COUNT(*) FILTER(WHERE a.status='active')::int AS active,
   COUNT(*) FILTER(WHERE a.status='active' AND a.starts_at>now())::int AS future,
   COUNT(*) FILTER(WHERE a.status='active' AND a.starts_at<=now() AND a.ends_at>now())::int AS ongoing,
   COUNT(*) FILTER(WHERE a.status='released')::int AS released
   FROM resource_allocations a WHERE a.owner_id=$2 AND a.order_id=$1`,[id,owner])).rows[0];
  const execution=(await client.query<Row>(`SELECT
   COUNT(*) FILTER(WHERE e.kind='report' AND NOT EXISTS
     (SELECT 1 FROM execution_entries rev WHERE rev.reverses_id=e.id))::int AS active,
   COUNT(*) FILTER(WHERE e.kind='report' AND EXISTS
     (SELECT 1 FROM execution_entries rev WHERE rev.reverses_id=e.id))::int AS corrected,
   COUNT(*) FILTER(WHERE e.kind='report' AND NOT EXISTS
     (SELECT 1 FROM execution_entries rev WHERE rev.reverses_id=e.id)
     AND NOT EXISTS(SELECT 1 FROM measurements m
       WHERE m.execution_entry_id=e.id AND m.order_id=$1 AND m.status<>'cancelled'))::int AS unmeasured
   FROM execution_entries e WHERE e.order_id=$1`,[id])).rows[0];
  const measurements=(await client.query<Row>(`SELECT
   COUNT(*) FILTER(WHERE m.status<>'cancelled')::int AS active,
   COUNT(*) FILTER(WHERE m.status IN ('draft','submitted'))::int AS pending,
   COUNT(*) FILTER(WHERE m.status='approved' AND NOT EXISTS
     (SELECT 1 FROM invoices i WHERE i.measurement_id=m.id AND i.order_id=$1))::int AS approved_unbilled,
   COUNT(*) FILTER(WHERE m.status='cancelled')::int AS cancelled
   FROM measurements m WHERE m.order_id=$1`,[id])).rows[0];
  const financial=(await client.query<Row>(`SELECT
   (SELECT COUNT(*)::int FROM invoices i WHERE i.order_id=$1) AS invoices,
   (SELECT COALESCE(SUM(i.amount::bigint),0)::text FROM invoices i WHERE i.order_id=$1) AS billed,
   (SELECT COALESCE(SUM(CASE WHEN s.kind='receipt' THEN s.amount::bigint ELSE -s.amount::bigint END),0)::text
    FROM receivable_settlements s JOIN receivables r ON r.id=s.receivable_id
    JOIN invoices i ON i.id=r.invoice_id WHERE i.order_id=$1 AND s.actor_id=$2) AS received,
   (SELECT COALESCE(SUM(CASE WHEN c.kind='allocate' THEN c.amount::bigint ELSE -c.amount::bigint END),0)::text
    FROM enterprise_project_cost_allocations c WHERE c.service_order_id=$1 AND c.actor_id=$2) AS allocated_cost,
   (SELECT COUNT(*)::int FROM enterprise_project_cost_allocations c
    WHERE c.service_order_id=$1 AND c.actor_id=$2 AND c.kind='allocate'
      AND NOT EXISTS(SELECT 1 FROM enterprise_project_cost_allocations r WHERE r.reverses_id=c.id))
    AS cost_allocation_count`,[id,owner])).rows[0];
  const resourceRows=(await client.query<Row>(`SELECT a.id,a.resource_type,a.status,
   a.starts_at,a.ends_at,
   CASE WHEN a.resource_type='professional' THEN p.name ELSE asset.name END AS label
   FROM resource_allocations a
   LEFT JOIN professionals p ON p.id=a.resource_id AND p.owner_id=a.owner_id AND a.resource_type='professional'
   LEFT JOIN assets asset ON asset.id=a.resource_id AND asset.owner_id=a.owner_id AND a.resource_type='asset'
   WHERE a.order_id=$1 AND a.owner_id=$2
   ORDER BY a.starts_at DESC,a.id DESC LIMIT 9`,[id,owner])).rows;
  const executionRows=(await client.query<Row>(`SELECT e.id,e.reference,e.resource_kind,
   e.quantity::text AS quantity_scaled,e.unit,e.effective_date
   FROM execution_entries e WHERE e.order_id=$1 AND e.kind='report'
   AND NOT EXISTS(SELECT 1 FROM execution_entries rev WHERE rev.reverses_id=e.id)
   ORDER BY e.created_at DESC,e.id DESC LIMIT 9`,[id])).rows;
  const measurementRows=(await client.query<Row>(`SELECT m.id,m.status,m.description,m.amount::text AS amount_scaled,
   m.execution_entry_id, i.id AS invoice_id
   FROM measurements m LEFT JOIN invoices i ON i.measurement_id=m.id AND i.order_id=$1
   WHERE m.order_id=$1 ORDER BY m.created_at DESC,m.id DESC LIMIT 9`,[id])).rows;
  const costRows=(await client.query<Row>(`SELECT c.id,c.kind,c.amount::text AS amount_scaled,
   c.payable_id,c.reference,c.created_at,
   EXISTS(SELECT 1 FROM enterprise_project_cost_allocations r WHERE r.reverses_id=c.id) AS reversed
   FROM enterprise_project_cost_allocations c
   WHERE c.service_order_id=$1 AND c.actor_id=$2
   ORDER BY c.created_at DESC,c.id DESC LIMIT 9`,[id,owner])).rows;
  await client.query('COMMIT');

  const evidence={
   allocations:asCount(resource?.active),futureAllocations:asCount(resource?.future),
   allocationsOngoingNow:asCount(resource?.ongoing),releasedAllocations:asCount(resource?.released),
   activeExecution:asCount(execution?.active),correctedExecution:asCount(execution?.corrected),
   unmeasuredExecution:asCount(execution?.unmeasured),
   measurements:asCount(measurements?.active),pendingMeasurements:asCount(measurements?.pending),
   approvedUnbilled:asCount(measurements?.approved_unbilled),
   cancelledMeasurements:asCount(measurements?.cancelled),
   invoices:asCount(financial?.invoices),activeCostAllocations:asCount(financial?.cost_allocation_count)
  };
  const control=assessServiceOrderControl(
   {status:String(order.status),dueDate:order.due_date?String(order.due_date).slice(0,10):null},
   evidence,
   {billedScaled:asMoney(financial?.billed),receivedScaled:asMoney(financial?.received),
    attributedCostScaled:asMoney(financial?.allocated_cost)}
  );
  const mapResource=(r:Row)=>({
   id:String(r.id),resourceType:String(r.resource_type),status:String(r.status),
   label:r.label?String(r.label):'Recurso cadastral indisponível',
   startsAt:String(r.starts_at),endsAt:String(r.ends_at)
  });
  return respond({
   order:{id:String(order.id),title:String(order.title),client:String(order.client),
    status:String(order.status),category:String(order.category),version:Number(order.version),
    dueDate:order.due_date?String(order.due_date).slice(0,10):null,
    clientId:order.client_id?String(order.client_id):null,
    contractId:order.contract_id?String(order.contract_id):null},
   evidence:{...evidence},control,
   recent:{
    allocations:resourceRows.slice(0,8).map(mapResource),
    allocationsTruncated:resourceRows.length>8,
    execution:executionRows.slice(0,8).map(r=>({
     id:String(r.id),reference:String(r.reference),kind:String(r.resource_kind),
     quantityScaled:String(r.quantity_scaled),unit:String(r.unit),effectiveDate:String(r.effective_date)
    })),executionTruncated:executionRows.length>8,
    measurements:measurementRows.slice(0,8).map(r=>({
     id:String(r.id),status:String(r.status),description:String(r.description),
     amountScaled:String(r.amount_scaled),
     executionId:r.execution_entry_id?String(r.execution_entry_id):null,
     invoiceId:r.invoice_id?String(r.invoice_id):null
    })),measurementsTruncated:measurementRows.length>8,
    costs:costRows.slice(0,8).map(r=>({
     id:String(r.id),kind:String(r.kind),amountScaled:String(r.amount_scaled),
     payableId:String(r.payable_id),reference:String(r.reference),reversed:Boolean(r.reversed)
    })),costsTruncated:costRows.length>8
   },
   source:'owned_service_order_real_resources_execution_measurement_revenue_cost',
   consistency:'REPEATABLE READ READ ONLY',
   warnings:[
    'Custo representa apenas alocações analíticas de contas a pagar, não o custo total do serviço.',
    'Recebimento representa eventos persistidos do contas a receber; não confirma conciliação bancária nem disponibilidade de caixa.',
    'Contribuição parcial não é margem líquida, lucro final ou fechamento contábil.',
    'Faltas documentais são sinais de atenção, não bloqueios automáticos de transição.'
   ],
   generatedAt:new Date().toISOString()
  },context);
 }catch(error){
  if(client){try{await client.query('ROLLBACK');}catch{/* preserve original error */}}
  return failure(error,context);
 }finally{client?.release();}
}
