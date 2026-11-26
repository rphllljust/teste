import {z} from 'zod';
import {database} from '../../../../db/raw';
import {ApiError,failure,fingerprint,jsonBody,requestContext,respond,type RequestContext} from '../../../../lib/api/http';

const input=z.object({id:z.string().uuid(),orderId:z.string().uuid(),resourceType:z.enum(['professional','asset']),resourceId:z.string().uuid(),startsAt:z.string().datetime(),endsAt:z.string().datetime()}).strict();
const storedResult=(value:unknown)=>typeof value==='string'?JSON.parse(value) as Record<string,unknown>:value as Record<string,unknown>;

export const dynamic = 'force-dynamic';
const viewInput=z.object({
  from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  resourceType:z.enum(['all','professional','asset']).default('all'),
  status:z.enum(['active','released','all']).default('active'),
}).strict();
/** Read-only, actor-scoped allocation calendar. The API returns recorded bookings,
 * never extrapolated availability or invented workforce capacity. */
export async function GET(request:Request){
 let context:RequestContext|undefined;
 try{
  context=requestContext(request);
  const query=new URL(request.url).searchParams;
  const parsed=viewInput.safeParse({
   from:query.get('from')??'',
   to:query.get('to')??'',
   resourceType:query.get('resourceType')??'all',
   status:query.get('status')??'active',
  });
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Informe período válido do planejamento.');
  const p=parsed.data,begin=new Date(p.from+'T00:00:00.000Z'),end=new Date(p.to+'T00:00:00.000Z');
  const days=(end.valueOf()-begin.valueOf())/86400000;
  if(!Number.isFinite(days)||days<1||days>31||begin.toISOString().slice(0,10)!==p.from||end.toISOString().slice(0,10)!==p.to)
   throw new ApiError(400,'VALIDATION_FAILED','A consulta deve abranger entre 1 e 31 dias.');
  const rows=await database().prepare(`SELECT a.id,a.order_id,a.resource_type,a.resource_id,
      a.starts_at,a.ends_at,a.status,a.row_version,a.created_at,
      o.title AS order_title,o.client AS order_client,o.status AS order_status,
      CASE WHEN a.resource_type='professional' THEN p.name ELSE asset.name END AS resource_name,
      CASE WHEN a.resource_type='professional' THEN p.registration ELSE asset.code END AS resource_reference
      FROM resource_allocations a
      INNER JOIN service_orders o ON o.id=a.order_id AND o.owner_id=a.owner_id
      LEFT JOIN professionals p ON a.resource_type='professional' AND p.id=a.resource_id AND p.owner_id=a.owner_id
      LEFT JOIN assets asset ON a.resource_type='asset' AND asset.id=a.resource_id AND asset.owner_id=a.owner_id
      WHERE a.owner_id=? AND a.starts_at < ? AND a.ends_at > ?
        AND (?='all' OR a.resource_type=?)
        AND (?='all' OR a.status=?)
      ORDER BY a.starts_at ASC,a.id ASC LIMIT 501`)
   .bind(context.actorId,end.toISOString(),begin.toISOString(),p.resourceType,p.resourceType,p.status,p.status)
   .all<Record<string,unknown>>();
  const items=rows.results.slice(0,500).map(row=>({
   id:String(row.id),orderId:String(row.order_id),resourceType:String(row.resource_type),
   resourceId:String(row.resource_id),startsAt:String(row.starts_at),endsAt:String(row.ends_at),
   status:String(row.status),rowVersion:Number(row.row_version),createdAt:String(row.created_at),
   orderTitle:String(row.order_title),orderClient:String(row.order_client),orderStatus:String(row.order_status),
   resourceName:row.resource_name?String(row.resource_name):'Recurso cadastral indisponível',
   resourceReference:row.resource_reference?String(row.resource_reference):null,
  }));
  return respond({items,limited:rows.results.length>500,
   range:{from:p.from,to:p.to},source:'postgres_owner_scoped_allocations'},context);
 }catch(err){return failure(err,context);}
}

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

