import {z} from 'zod';
import {database} from '../../../../db/raw';
import {ApiError,failure,fingerprint,jsonBody,requestContext,respond,type RequestContext} from '../../../../lib/api/http';

const input=z.object({id:z.string().uuid(),orderId:z.string().uuid(),resourceType:z.enum(['professional','asset']),resourceId:z.string().uuid(),startsAt:z.string().datetime(),endsAt:z.string().datetime()}).strict();
const storedResult=(value:unknown)=>typeof value==='string'?JSON.parse(value) as Record<string,unknown>:value as Record<string,unknown>;

export async function POST(request:Request){
 let context:RequestContext|undefined;
 try{
  context=requestContext(request,true);
  const actor=context.actorId,correlationId=context.correlationId;
  const parsed=input.safeParse(await jsonBody(request));
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Alocação inválida.');
  const p=parsed.data,starts=new Date(p.startsAt),ends=new Date(p.endsAt);
  if(!(ends>starts))throw new ApiError(400,'VALIDATION_FAILED','A janela deve terminar depois do início.');
  const hash=await fingerprint({actor:context.actorId,command:'allocate_resource',payload:p});
  const result=await database().transaction(async q=>{
   const prior=await q('SELECT result,actor_id,request_hash FROM resource_allocation_events WHERE id=$1',[p.id]);
   if(prior.rows.length){const old=prior.rows[0] as {result:unknown;actor_id:string;request_hash:string};if(old.actor_id!==context!.actorId||old.request_hash!==hash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Chave de alocação já utilizada.');return storedResult(old.result);}
   const order=await q("SELECT id,status FROM service_orders WHERE id=$1 AND owner_id=$2 FOR UPDATE",[p.orderId,actor]);
   if(!order.rowCount)throw new ApiError(404,'NOT_FOUND','OS não encontrada.');
   if(!['planned','authorized','executing'].includes(String(order.rows[0].status)))throw new ApiError(409,'INVALID_STATE','A OS não aceita alocações neste estado.');
   if(p.resourceType==='professional'){
    const resource=await q("SELECT id FROM professionals WHERE id=$1 AND owner_id=$2 AND status='active' FOR UPDATE",[p.resourceId,actor]);
    if(!resource.rowCount)throw new ApiError(409,'RESOURCE_UNAVAILABLE','Profissional indisponível ou não pertence à empresa.');
   }else{
    const resource=await q("SELECT id FROM assets WHERE id=$1 AND owner_id=$2 AND status='active' FOR UPDATE",[p.resourceId,actor]);
    if(!resource.rowCount)throw new ApiError(409,'RESOURCE_UNAVAILABLE','Ativo indisponível, em manutenção ou não pertence à empresa.');
   }
   const conflict=await q(`SELECT id FROM resource_allocations WHERE owner_id=$1 AND resource_type=$2 AND resource_id=$3 AND status='active' AND starts_at < $5 AND ends_at > $4 FOR UPDATE`,[actor,p.resourceType,p.resourceId,starts.toISOString(),ends.toISOString()]);
   if(conflict.rowCount)throw new ApiError(409,'SCHEDULE_CONFLICT','O recurso já está alocado nesta janela.');
   const now=new Date().toISOString(),receipt={ok:true,resource:{type:'resourceAllocation',id:p.id,rowVersion:1},refreshPolicy:['resource-planning','service-order']};
   await q('INSERT INTO resource_allocations(id,owner_id,order_id,resource_type,resource_id,starts_at,ends_at,actor_id,request_hash,correlation_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$2,$8,$9,$10)',[p.id,actor,p.orderId,p.resourceType,p.resourceId,starts.toISOString(),ends.toISOString(),hash,correlationId,now]);
   await q('INSERT INTO resource_allocation_events(id,allocation_id,owner_id,command,version,actor_id,request_hash,result,correlation_id,created_at) VALUES($1,$2,$3,$4,$5,$3,$6,$7,$8,$9)',[p.id,p.id,actor,'allocate',1,hash,JSON.stringify(receipt),correlationId,now]);
   return receipt;
  });
  return respond(result,context,201);
 }catch(error){if(error instanceof Error&&/resource_allocations_no_overlap|exclusion constraint/i.test(error.message))return failure(new ApiError(409,'SCHEDULE_CONFLICT','O recurso já está alocado nesta janela.'),context);return failure(error,context)}
}

