import {z} from 'zod';
import {database} from '../../../../../db/raw';
import {ApiError,failure,fingerprint,jsonBody,requestContext,respond,type RequestContext} from '../../../../../lib/api/http';
import {allowedMilestoneCodes,milestoneDescriptors} from '../../../../../lib/domain/service-order-milestones.mjs';

export const dynamic='force-dynamic';
const uuid=z.string().uuid();
const input=z.discriminatedUnion('command',[
 z.object({command:z.literal('record'),key:uuid,expectedRevision:z.number().int().min(0),
  checkpoint:z.enum(['site_readiness','resources_verified','safety_reviewed',
   'execution_inspected','quality_checked','handover_recorded']),
  reference:z.string().trim().min(3).max(160),
  note:z.string().trim().min(10).max(1000)}).strict(),
 z.object({command:z.literal('revoke'),key:uuid,expectedRevision:z.number().int().min(0),
  targetId:uuid,reason:z.string().trim().min(10).max(1000)}).strict(),
]);
type Query=(sql:string,params?:unknown[])=>Promise<{rows:Array<Record<string,unknown>>;rowCount:number|null}>;
const unpack=(value:unknown)=>typeof value==='string'?JSON.parse(value):value;
const orderSql='SELECT id,status FROM service_orders WHERE id=$1 AND owner_id=$2';

export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request);
  const id=(await params).id;
  if(!uuid.safeParse(id).success)throw new ApiError(400,'VALIDATION_FAILED','OS inválida.');
  const data=await database().transaction(async(q:Query)=>{
   await q('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const owned=await q(orderSql,[id,ctx!.actorId]);
   if(!owned.rows.length)throw new ApiError(404,'NOT_FOUND','OS não encontrada neste contexto.');
   const order=owned.rows[0];
   const total=await q('SELECT COUNT(*)::int AS total,COALESCE(MAX(sequence),0)::int AS revision FROM service_order_milestone_events WHERE order_id=$1 AND owner_id=$2',[id,ctx!.actorId]);
   const active=await q(`SELECT e.id,e.checkpoint,e.reference,e.note,e.created_at,e.sequence
     FROM service_order_milestone_events e
     WHERE e.order_id=$1 AND e.owner_id=$2 AND e.kind='record'
       AND NOT EXISTS (SELECT 1 FROM service_order_milestone_events reversal
         WHERE reversal.reverses_id=e.id AND reversal.owner_id=$2)
     ORDER BY e.sequence DESC LIMIT 10`,[id,ctx!.actorId]);
   const history=await q(`SELECT id,sequence,kind,checkpoint,reference,note,reverses_id,created_at
      FROM service_order_milestone_events WHERE order_id=$1 AND owner_id=$2
      ORDER BY sequence DESC LIMIT 31`,[id,ctx!.actorId]);
   return {status:String(order.status),revision:Number(total.rows[0]?.revision??0),
    total:Number(total.rows[0]?.total??0),active:active.rows,history:history.rows};
  });
  const activeIds=new Set(data.active.map(v=>String(v.checkpoint)));
  const eligible=new Set(allowedMilestoneCodes(data.status));
  return respond({
   orderId:id,orderStatus:data.status,revision:data.revision,
   items:milestoneDescriptors.map(v=>({...v,active:activeIds.has(v.code),
    canRecord:eligible.has(v.code)&&!activeIds.has(v.code),
    source:data.active.find(r=>r.checkpoint===v.code)??null})),
   history:data.history.slice(0,30).map(r=>({
    id:String(r.id),sequence:Number(r.sequence),command:String(r.kind),
    checkpoint:String(r.checkpoint),reference:String(r.reference),
    note:String(r.note),reversesId:r.reverses_id?String(r.reverses_id):null,
    createdAt:String(r.created_at)
   })),
   pageInfo:{total:data.total,limit:30,hasMore:data.total>30},
   source:'owned_postgres_append_only_service_milestones',
   warnings:[
    'Marco é um registro interno de evidência; não certifica aceite do cliente nem conformidade legal.',
    'Registrar ou revogar um marco não altera situação, versão, medição, fatura ou escrituração da OS.',
    'O histórico preserva o registro original após uma reversão.'
   ]
  },ctx);
 }catch(error){return failure(error,ctx);}
}

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request,true);
  const id=(await params).id;
  if(!uuid.safeParse(id).success)throw new ApiError(400,'VALIDATION_FAILED','OS inválida.');
  const parsed=input.safeParse(await jsonBody(request));
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Comando de marco operacional inválido.');
  const p=parsed.data,hash=await fingerprint({owner:ctx.actorId,orderId:id,payload:p});
  const result=await database().transaction(async(q:Query)=>{
   // The OS row lock serializes milestone revisions for this order, avoiding
   // lost updates under concurrent operators without changing OS row_version.
   const owned=await q(orderSql+' FOR UPDATE',[id,ctx!.actorId]);
   if(!owned.rows.length)throw new ApiError(404,'NOT_FOUND','OS não encontrada neste contexto.');
   const status=String(owned.rows[0].status);
   const prior=await q('SELECT owner_id,request_hash,result FROM service_order_milestone_events WHERE id=$1',[p.key]);
   if(prior.rows.length){
    if(prior.rows[0].owner_id!==ctx!.actorId||prior.rows[0].request_hash!==hash)
     throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Identificador já utilizado por outro comando.');
    return {...unpack(prior.rows[0].result),replayed:true} as Record<string,unknown>;
   }
   const version=await q('SELECT COALESCE(MAX(sequence),0)::int AS revision FROM service_order_milestone_events WHERE order_id=$1 AND owner_id=$2',[id,ctx!.actorId]);
   const revision=Number(version.rows[0]?.revision??0);
   if(p.expectedRevision!==revision)throw new ApiError(409,'VERSION_CONFLICT','Marcos alterados por outra sessão. Recarregue a OS.');
   let checkpoint:string,reference:string,note:string,reversesId:string|null=null;
   if(p.command==='record'){
    checkpoint=p.checkpoint;reference=p.reference;note=p.note;
    if(!allowedMilestoneCodes(status).includes(checkpoint))
     throw new ApiError(409,'INVALID_STATE','O estado atual da OS não permite registrar este marco.');
    const exists=await q(`SELECT e.id FROM service_order_milestone_events e
      WHERE e.order_id=$1 AND e.owner_id=$2 AND e.checkpoint=$3 AND e.kind='record'
       AND NOT EXISTS(SELECT 1 FROM service_order_milestone_events r
         WHERE r.reverses_id=e.id AND r.owner_id=$2)`,[id,ctx!.actorId,checkpoint]);
    if(exists.rows.length)throw new ApiError(409,'MILESTONE_ALREADY_ACTIVE','O marco já está vigente nesta OS.');
   }else{
    const source=await q(`SELECT e.id,e.checkpoint,e.reference FROM service_order_milestone_events e
      WHERE e.id=$1 AND e.order_id=$2 AND e.owner_id=$3 AND e.kind='record'
        AND NOT EXISTS(SELECT 1 FROM service_order_milestone_events r
          WHERE r.reverses_id=e.id AND r.owner_id=$3) FOR UPDATE OF e`,[p.targetId,id,ctx!.actorId]);
    if(!source.rows.length)throw new ApiError(409,'MILESTONE_NOT_ACTIVE','O marco não existe, foi revogado ou não pertence à OS.');
    checkpoint=String(source.rows[0].checkpoint);
    reference=String(source.rows[0].reference);
    note=p.reason;
    reversesId=p.targetId;
   }
   const sequence=revision+1;
   const receipt={ok:true,resource:{type:'serviceOrderMilestone',id:p.key,orderId:id,
    checkpoint,revision:sequence,state:p.command==='record'?'recorded':'revoked'},
    refreshPolicy:['serviceOrder.context','serviceOrders.worklist','operation.workspace']};
   await q(`INSERT INTO service_order_milestone_events
    (id,owner_id,order_id,sequence,kind,checkpoint,reference,note,reverses_id,actor_id,
     request_hash,correlation_id,result,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$2,$10,$11,$12,$13)`,
    [p.key,ctx!.actorId,id,sequence,p.command,checkpoint,reference,note,
     reversesId,hash,ctx!.correlationId,JSON.stringify(receipt),new Date().toISOString()]);
   return receipt;
  });
  return respond(result,ctx,'replayed' in result?200:201);
 }catch(error){return failure(error,ctx);}
}
