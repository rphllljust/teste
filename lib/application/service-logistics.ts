import {ApiError} from '../api/http';
import {isVerifiedOwner,memberRole,type Query} from './service-needs';

type Context={tenantId:string;needId:string;actorId:string};
const text=(v:unknown)=>String(v??'');
const number=(v:unknown)=>Number(v??0);
type Finding={code:string;ok:boolean;detail:string};
/**
 * Live cross-domain work-order logistics dossier. This endpoint does not
 * manufacture inventory, bookings or receipts, and grants read access only
 * to the two declared, verified enterprise owners within the same tenant.
 *
 * The canonical financial/stock principal remains service_orders.owner_id:
 * co-owners may inspect this evidence but cannot impersonate that identity
 * to book inventory or resource capacity.
 */
export async function getServiceLogistics(q:Query,c:Context){
 await memberRole(q,c.tenantId,c.actorId);
 if(!await isVerifiedOwner(q,c.tenantId,c.actorId))
  throw new ApiError(403,'FORBIDDEN','Dossiê logístico disponível somente aos controladores verificados.');
 const found=await q(`SELECT n.order_id AS "orderId",n.status AS "needStatus",
  o.status AS "orderStatus",o.owner_id AS "ledgerOwnerId"
  FROM svc_needs n LEFT JOIN service_orders o ON o.id=n.order_id
  WHERE n.tenant_id=$1 AND n.id=$2`,[c.tenantId,c.needId]);
 if(!found.rows.length)throw new ApiError(404,'NOT_FOUND','Necessidade não encontrada na empresa autenticada.');
 const n=found.rows[0],orderId=text(n.orderId),ownerId=text(n.ledgerOwnerId);
 if(!orderId||!ownerId)return {status:'ORDER_NOT_CREATED',orderId:null,
  needStatus:text(n.needStatus),orderStatus:null,canMutate:false,
  reservations:[],resources:[],consumption:[],findings:[],
  source:'postgres_tenant_scoped_logistics',readOnly:true};
 const planned=await q(`SELECT kind,count(*)::int AS n FROM svc_plan_lines
  WHERE tenant_id=$1 AND need_id=$2 GROUP BY kind`,[c.tenantId,c.needId]);
 const reservations=await q(`SELECT r.id,r.item_id AS "itemId",i.sku,i.name,i.unit,
  r.quantity::text AS "quantityMilli",r.consumed_quantity::text AS "consumedMilli",
  r.status,r.source_reference AS "reference",r.created_at AS "createdAt"
  FROM inventory_reservations r
  JOIN inventory_items i ON i.id=r.item_id AND i.owner_id=r.owner_id
  WHERE r.owner_id=$1 AND r.source_document_type='service-order'
   AND r.source_document_id=$2
  ORDER BY r.created_at DESC,r.id DESC LIMIT 101`,[ownerId,orderId]);
 const allocations=await q(`SELECT a.id,a.resource_type AS "resourceType",a.resource_id AS "resourceId",
  a.starts_at AS "startsAt",a.ends_at AS "endsAt",a.status,
  CASE WHEN a.resource_type='asset' THEN asset.name ELSE p.name END AS "resourceName"
  FROM resource_allocations a
  LEFT JOIN professionals p ON a.resource_type='professional' AND p.id=a.resource_id AND p.owner_id=a.owner_id
  LEFT JOIN assets asset ON a.resource_type='asset' AND asset.id=a.resource_id AND asset.owner_id=a.owner_id
  WHERE a.owner_id=$1 AND a.order_id=$2
  ORDER BY a.created_at DESC,a.id DESC LIMIT 101`,[ownerId,orderId]);
 const consumption=await q(`SELECT e.id,e.item_id AS "itemId",i.sku,i.name,i.unit,
  e.quantity::text AS "quantityMilli",e.reference,
  (r.id IS NOT NULL AND r.source_document_type='service-order'
   AND r.source_document_id=e.order_id AND r.item_id=e.item_id
   AND r.owner_id=e.owner_id
   AND m.id IS NOT NULL AND m.owner_id=e.owner_id
   AND m.item_id=e.item_id AND m.order_id=e.order_id
   AND m.delta=-e.quantity) AS "sourceVerified"
  FROM inventory_consumption_events e
  LEFT JOIN inventory_reservations r ON r.id=e.reservation_id
  LEFT JOIN inventory_movements m ON m.id=e.movement_id
  LEFT JOIN inventory_items i ON i.id=e.item_id AND i.owner_id=e.owner_id
  WHERE e.owner_id=$1 AND e.order_id=$2
  ORDER BY e.id DESC LIMIT 101`,[ownerId,orderId]);
 const planCounts=Object.fromEntries(planned.rows.map(r=>[text(r.kind),number(r.n)]));
 const materials=number(planCounts.material),resources=number(planCounts.team)+number(planCounts.vehicle)+number(planCounts.equipment);
 const activeReservations=reservations.rows.filter(r=>['reserved','consumed'].includes(text(r.status)));
 const activeAllocations=allocations.rows.filter(a=>text(a.status)==='active');
 const broken=consumption.rows.filter(x=>x.sourceVerified!==true);
 const findings:Finding[]=[
  {code:'CANONICAL_ORDER',ok:!!orderId,detail:'Existe OS canônica vinculada à necessidade empresarial.'},
  {code:'MATERIAL_RESERVATIONS',ok:materials===0||activeReservations.length>0,
   detail:materials===0?'Planejamento sem linha de material.':
    'Existem materiais planejados: verifique reserva por item e unidade antes do consumo.'},
  {code:'RESOURCE_ALLOCATIONS',ok:resources===0||activeAllocations.length>0,
   detail:resources===0?'Planejamento sem equipe, veículo ou equipamento.':
    'Existem recursos previstos: confirme capacidade, janela de utilização e alocação por recurso.'},
  {code:'STOCK_MOVEMENT_PROVENANCE',ok:broken.length===0&&consumption.rows.length<=100,
   detail:'Todo consumo listado deve referenciar reserva da mesma OS e saída de estoque equivalente.'},
 ];
 return {
  status:findings.every(x=>x.ok)?'EVIDENCE_RECORDED':'ATTENTION_REQUIRED',
  needStatus:text(n.needStatus),orderId,orderStatus:text(n.orderStatus),
  canMutate:ownerId===c.actorId,
  canReserve:ownerId===c.actorId&&['planned','authorized','executing'].includes(text(n.orderStatus)),
  canConsume:ownerId===c.actorId&&text(n.orderStatus)==='executing',
  canAllocate:ownerId===c.actorId&&['planned','authorized','executing'].includes(text(n.orderStatus)),
  findings,planCounts,
  reservations:reservations.rows.slice(0,100),resources:allocations.rows.slice(0,100),
  consumption:consumption.rows.slice(0,100),
  summary:{plannedMaterialLines:materials,plannedResourceLines:resources,
   reservationCount:activeReservations.length,activeAllocationCount:activeAllocations.length,
   consumptionEvents:consumption.rows.length,brokenConsumptionEvidence:broken.length,
   truncated:reservations.rows.length>100||allocations.rows.length>100||consumption.rows.length>100},
  source:'postgres_tenant_scoped_service_to_inventory_capacity_and_consumption',
  readOnly:true,
  caution:'Contagens de reserva e capacidade não comprovam correspondência item a item com texto livre do plano. Não certifica disponibilidade física, habilitações da equipe, horas executadas nem homologação humana.',
  checkedAt:new Date().toISOString(),
 };
}
