import {z} from 'zod';
import {database} from '../../../../db/raw';
import {ApiError,failure,requestContext,respond,validDate,type RequestContext} from '../../../../lib/api/http';

// Authority: persisted, owner-scoped PostgreSQL facts. No sampled business totals,
// client-side aggregation, optimistic finance balances, or mutations.
export const dynamic='force-dynamic';
const query=z.object({asOf:z.string().refine(validDate).optional()}).strict();
type Fact={id:string;title?:string;reference?:string;date?:string;
  availableScaled?:string;requiredScaled?:string;outstandingScaled?:string;
  totalCount?:number|string;totalAmount?:number|string};
type LaneId='lateOrders'|'unmeasuredOrders'|'overdueReceivables'|
  'overduePayables'|'latePurchases'|'stockShortage'|'myApprovals';
type Lane={id:LaneId;label:string;target:string;count:number;
  totalAmountScaled:string|null;authority:string;items:Array<{
    id:string;title:string;reference:string|null;date:string|null;
    amountScaled:string|null;availableScaled:string|null;requiredScaled:string|null;
  }>};
const specs:Array<{id:LaneId;label:string;target:string;authority:string}>= [
 {id:'lateOrders',label:'Ordens em atraso',target:'Centro de operações',authority:'service_orders.due_date.v1'},
 {id:'unmeasuredOrders',label:'Concluídas sem medição aprovada',target:'Medições',authority:'measurements.approval_state.v1'},
 {id:'overdueReceivables',label:'Recebíveis vencidos',target:'Financeiro',authority:'receivables.settlement_ledger.v1'},
 {id:'overduePayables',label:'Obrigações vencidas',target:'Contas a pagar',authority:'payables.payment_ledger.v1'},
 {id:'latePurchases',label:'Compras não recebidas no prazo',target:'Compras',authority:'supplier_purchase_orders.expected_on.v1'},
 {id:'stockShortage',label:'Materiais abaixo do mínimo',target:'Estoque e compras',authority:'inventory.movements_reservations.v1'},
 {id:'myApprovals',label:'Aprovações atribuídas',target:'Fechamentos',authority:'workflow_approval_requests.pending_assignee.v1'},
];
export async function GET(request:Request){
 let context:RequestContext|undefined;
 try{
  context=requestContext(request);
  const parsed=query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Data de referência inválida.');
  const asOf=parsed.data.asOf??new Date().toISOString().slice(0,10);
  const db=database();
  // Each projection is bounded to six rows but COUNT and SUM use the entire
  // eligible owner-scoped set. One transaction prevents inter-lane partial reads.
  const rows=await db.batch([
   db.prepare(`SELECT o.id,o.title,o.due_date AS date,COUNT(*) OVER() AS "totalCount"
     FROM service_orders o WHERE o.owner_id=? AND o.status IN ('draft','authorized','executing')
       AND o.due_date IS NOT NULL AND o.due_date<?
     ORDER BY o.due_date ASC,o.id ASC LIMIT 6`).bind(context.actorId,asOf),
   db.prepare(`SELECT o.id,o.title,o.created_at AS date,COUNT(*) OVER() AS "totalCount"
     FROM service_orders o WHERE o.owner_id=? AND o.status='completed'
       AND NOT EXISTS(SELECT 1 FROM measurements m WHERE m.order_id=o.id
         AND m.status IN ('approved','billed'))
     ORDER BY o.created_at ASC,o.id ASC LIMIT 6`).bind(context.actorId),
   db.prepare(`SELECT id,title,date,CAST(outstanding AS TEXT) AS "outstandingScaled",
      COUNT(*) OVER() AS "totalCount",CAST(SUM(outstanding) OVER() AS TEXT) AS "totalAmount"
     FROM(
       SELECT r.id,o.title,r.due_date AS date,
        r.amount-COALESCE((SELECT SUM(CASE WHEN s.kind='receipt' THEN s.amount ELSE -s.amount END)
          FROM receivable_settlements s WHERE s.receivable_id=r.id),0) AS outstanding
       FROM receivables r JOIN invoices i ON i.id=r.invoice_id
       JOIN service_orders o ON o.id=i.order_id
       WHERE o.owner_id=? AND r.due_date<?
     ) r WHERE outstanding>0 ORDER BY date ASC,id ASC LIMIT 6`).bind(context.actorId,asOf),
   db.prepare(`SELECT id,title,date,CAST(outstanding AS TEXT) AS "outstandingScaled",
      COUNT(*) OVER() AS "totalCount",CAST(SUM(outstanding) OVER() AS TEXT) AS "totalAmount"
     FROM(
       SELECT p.id,p.supplier AS title,p.due_date AS date,
        p.amount-COALESCE((SELECT SUM(CASE WHEN pp.kind='payment' THEN pp.amount ELSE -pp.amount END)
          FROM payable_payments pp WHERE pp.payable_id=p.id),0) AS outstanding
       FROM payables p WHERE p.actor_id=? AND p.due_date<?
     ) p WHERE outstanding>0 ORDER BY date ASC,id ASC LIMIT 6`).bind(context.actorId,asOf),
   db.prepare(`SELECT p.id,s.legal_name AS title,p.reference,p.expected_on AS date,
      COUNT(*) OVER() AS "totalCount"
     FROM supplier_purchase_orders p JOIN suppliers s
      ON s.id=p.supplier_id AND s.owner_id=p.owner_id
     WHERE p.owner_id=? AND p.status='approved' AND p.expected_on<?
     ORDER BY p.expected_on ASC,p.id ASC LIMIT 6`).bind(context.actorId,asOf),
   db.prepare(`SELECT id,title,reference,unit,
      CAST(available AS TEXT) AS "availableScaled",
      CAST(minimum AS TEXT) AS "requiredScaled",COUNT(*) OVER() AS "totalCount"
     FROM (
       SELECT i.id,i.name AS title,i.sku AS reference,i.unit,i.minimum,
         COALESCE((SELECT SUM(m.delta) FROM inventory_movements m
           WHERE m.item_id=i.id AND m.owner_id=i.owner_id),0)-
         COALESCE((SELECT SUM(r.quantity-r.consumed_quantity)
           FROM inventory_reservations r WHERE r.item_id=i.id
             AND r.owner_id=i.owner_id AND r.status='reserved'),0) AS available
       FROM inventory_items i WHERE i.owner_id=? AND i.minimum>0
     ) stock WHERE available<minimum
     ORDER BY (minimum-available) DESC,reference ASC,id ASC LIMIT 6`).bind(context.actorId),
   db.prepare(`SELECT a.id,a.entity_type||' · '||a.command AS title,
      a.created_at AS date,COUNT(*) OVER() AS "totalCount"
     FROM workflow_approval_requests a
     WHERE a.owner_id=? AND a.approver_id=? AND a.state='pending'
     ORDER BY a.created_at ASC,a.id ASC LIMIT 6`).bind(context.actorId,context.actorId),
  ]);
  const lanes:Lane[]=specs.map((spec,index)=>{
    const facts=rows[index].results as Fact[];
    const first=facts[0];
    return {...spec,count:Number(first?.totalCount??0),
      totalAmountScaled:index===2||index===3?String(first?.totalAmount??'0'):null,
      items:facts.map(f=>({
        id:String(f.id),title:String(f.title??'Registro'),
        reference:f.reference==null?null:String(f.reference),
        date:f.date==null?null:String(f.date),
        amountScaled:f.outstandingScaled==null?null:String(f.outstandingScaled),
        availableScaled:f.availableScaled==null?null:String(f.availableScaled),
        requiredScaled:f.requiredScaled==null?null:String(f.requiredScaled),
      })),
    };
  });
  return respond({asOf,generatedAt:new Date().toISOString(),
    authority:'owner_scoped_persisted_postgresql.v1',
    sampleLimitPerLane:6,lanes},context);
 }catch(error){return failure(error,context);}
}
