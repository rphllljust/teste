import {z} from 'zod';
import {database} from '../../../../../db/raw';
import {ApiError,failure,jsonBody,requestContext,respond,type RequestContext} from '../../../../../lib/api/http';
export const dynamic='force-dynamic';
const schema=z.object({orderId:z.string().uuid(),resourceType:z.enum(['professional','asset']),
 resourceId:z.string().uuid(),startsAt:z.string().datetime(),endsAt:z.string().datetime()}).strict();
/** Read-only. Booking POST alone reserves capacity under database locks. */
export async function POST(request:Request){
 let context:RequestContext|undefined;
 try{
  context=requestContext(request);
  const parsed=schema.safeParse(await jsonBody(request));
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Informe OS, recurso e período válidos.');
  const p=parsed.data,start=new Date(p.startsAt),end=new Date(p.endsAt);
  if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start)
   throw new ApiError(400,'VALIDATION_FAILED','Janela de alocação inválida.');
  const result=await database().transaction(async q=>{
   const order=await q('SELECT id,status FROM service_orders WHERE id=$1 AND owner_id=$2',[p.orderId,context!.actorId]);
   if(!order.rowCount)throw new ApiError(404,'NOT_FOUND','OS não encontrada neste contexto.');
   const resource=await q(p.resourceType==='asset'
    ? 'SELECT id,name,status FROM assets WHERE id=$1 AND owner_id=$2'
    : 'SELECT id,name,status FROM professionals WHERE id=$1 AND owner_id=$2',
    [p.resourceId,context!.actorId]);
   if(!resource.rowCount)throw new ApiError(404,'NOT_FOUND','Recurso não encontrado neste contexto.');
   const conflicts=await q(`SELECT a.id,a.order_id,a.starts_at,a.ends_at,o.title AS order_title
    FROM resource_allocations a
    JOIN service_orders o ON o.id=a.order_id AND o.owner_id=a.owner_id
    WHERE a.owner_id=$1 AND a.resource_type=$2 AND a.resource_id=$3 AND a.status='active'
     AND a.starts_at<$5 AND a.ends_at>$4
    ORDER BY a.starts_at,a.id LIMIT 6`,
    [context!.actorId,p.resourceType,p.resourceId,start.toISOString(),end.toISOString()]);
   const orderStatus=String(order.rows[0].status),resourceStatus=String(resource.rows[0].status);
   const findings=[
    {code:'ORDER_STATE_ALLOWED',ok:['planned','authorized','executing'].includes(orderStatus),
     detail:'A OS precisa estar planejada, autorizada ou em execução.'},
    {code:'RESOURCE_ACTIVE',ok:resourceStatus==='active',
     detail:'Recurso inativo, bloqueado ou em manutenção não pode ser alocado.'},
    {code:'NO_OVERLAPPING_ASSIGNMENT',ok:conflicts.rows.length===0,
     detail:'Já existe alocação ativa deste recurso neste período.'},
   ];
   return {ready:findings.every(x=>x.ok),findings,
    order:{id:p.orderId,status:orderStatus},
    resource:{id:p.resourceId,type:p.resourceType,name:String(resource.rows[0].name),status:resourceStatus},
    conflicts:conflicts.rows.slice(0,5).map(row=>({
     allocationId:String(row.id),orderId:String(row.order_id),orderTitle:String(row.order_title),
     startsAt:String(row.starts_at),endsAt:String(row.ends_at)})),
    conflictsTruncated:conflicts.rows.length>5,checkedAt:new Date().toISOString(),
    source:'postgres_actor_scoped_schedule',
    caution:'Consulta informativa, sem reserva. O comando final revalida disponibilidade transacionalmente.'};
  });
  return respond(result,context);
 }catch(e){return failure(e,context);}
}
