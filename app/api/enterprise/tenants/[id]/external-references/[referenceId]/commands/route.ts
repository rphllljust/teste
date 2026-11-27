import {z} from 'zod';
import {database} from '../../../../../../../db/raw';
import {ApiError,failure,fingerprint,jsonBody,requestContext,respond,type RequestContext} from '../../../../../../../lib/api/http';

export const dynamic='force-dynamic';
type Route={params:Promise<{id:string;referenceId:string}>};
const body=z.object({commandKey:z.string().uuid(),action:z.enum(['verify','reject']),expectedVersion:z.number().int().positive(),note:z.string().trim().max(500).nullable().optional()}).strict();

async function guard(query:(sql:string,params?:unknown[])=>Promise<{rows:Array<Record<string,unknown>>}>,tenantId:string,actorId:string){
 const r=await query(`SELECT m.role FROM enterprise_tenant_memberships m JOIN enterprise_tenants t ON t.id=m.tenant_id
 WHERE m.tenant_id=$1 AND m.actor_id=$2 AND m.status='active' AND t.status='active' FOR SHARE OF m,t`,[tenantId,actorId]);
 if(!r.rows.length)throw new ApiError(404,'NOT_FOUND','Empresa não encontrada no contexto autorizado.');
 if(!['owner','admin','auditor'].includes(String(r.rows[0].role)))throw new ApiError(403,'FORBIDDEN','Sua função não pode revisar referências empresariais.');
}

export async function POST(request:Request,route:Route){
 let ctx:RequestContext|undefined;
 try{
  ctx=requestContext(request,true);
  const {id:tenantId,referenceId}=await route.params;
  if(!z.string().uuid().safeParse(tenantId).success||!z.string().uuid().safeParse(referenceId).success)throw new ApiError(400,'VALIDATION_FAILED','Referência inválida.');
  const parsed=body.safeParse(await jsonBody(request));
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Comando de revisão inválido.');
  const command=parsed.data,target=command.action==='verify'?'verified':'rejected';
  const hash=await fingerprint({scope:'enterprise.externalReference.review',tenantId,referenceId,actor:ctx.actorId,command});
  const result=await database().transaction(async query=>{
   await guard(query,tenantId,ctx!.actorId);
   const prior=await query('SELECT actor_id,entity_type,entity_id,request_hash,result FROM business_commands WHERE id=$1 FOR UPDATE',[command.commandKey]);
   if(prior.rows.length){
    const p=prior.rows[0];
    if(p.actor_id!==ctx!.actorId||p.entity_type!=='enterpriseExternalReferenceReview'||p.entity_id!==referenceId||p.request_hash!==hash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Chave já utilizada com outros dados.');
    return {...JSON.parse(String(p.result)),replayed:true};
   }
   const found=await query('SELECT id,status,row_version FROM enterprise_external_references WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[referenceId,tenantId]);
   if(!found.rows.length)throw new ApiError(404,'NOT_FOUND','Referência externa não encontrada.');
   const current=found.rows[0];
   if(Number(current.row_version)!==command.expectedVersion)throw new ApiError(409,'VERSION_CONFLICT','A referência foi alterada; atualize e tente novamente.');
   if(current.status!=='pending_review')throw new ApiError(409,'INVALID_TRANSITION','Somente referências pendentes podem ser revisadas.');
   const now=new Date().toISOString();
   await query('UPDATE enterprise_external_references SET status=$1,reviewed_by=$2,reviewed_at=$3,review_note=$4,updated_at=$3,row_version=row_version+1 WHERE id=$5 AND tenant_id=$6',[target,ctx!.actorId,now,command.note??null,referenceId,tenantId]);
   await query(`INSERT INTO enterprise_external_reference_events(id,tenant_id,reference_id,action,from_status,to_status,actor_id,request_hash,correlation_id,note,created_at)
    VALUES($1,$2,$3,$4,'pending_review',$5,$6,$7,$8,$9,$10)`,[crypto.randomUUID(),tenantId,referenceId,command.action==='verify'?'verified':'rejected',target,ctx!.actorId,hash,ctx!.correlationId,command.note??null,now]);
   await query(`INSERT INTO enterprise_permission_events(id,tenant_id,actor_id,action,resource_id,correlation_id,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,[crypto.randomUUID(),tenantId,ctx!.actorId,'external_reference.'+target,referenceId,ctx!.correlationId,now]);
   const receipt={id:referenceId,tenantId,status:target,rowVersion:Number(current.row_version)+1};
   await query(`INSERT INTO business_commands(id,actor_id,entity_type,entity_id,command,request_hash,result,correlation_id,created_at)
    VALUES($1,$2,'enterpriseExternalReferenceReview',$3,$4,$5,$6,$7,$8)`,[command.commandKey,ctx!.actorId,referenceId,command.action,hash,JSON.stringify(receipt),ctx!.correlationId,now]);
   return {...receipt,replayed:false};
  });
  return respond(result,ctx,result.replayed?200:200);
 }catch(error){return failure(error,ctx);}
}
