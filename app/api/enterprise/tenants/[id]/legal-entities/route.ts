import { z } from 'zod';
import { database } from '../../../../../../db/raw';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../../../lib/api/http';

export const dynamic='force-dynamic';
type Route={params:Promise<{id:string}>};
const command=z.object({
  id:z.string().uuid(),commandKey:z.string().uuid(),
  code:z.string().regex(/^[A-Z0-9][A-Z0-9_-]{1,19}$/),
  name:z.string().trim().min(3).max(160),
  taxId:z.string().regex(/^\d{11}(\d{3})?$/).optional(),
}).strict();

async function guardMember(
  query:(sql:string,params?:unknown[])=>Promise<{rows:Array<Record<string,unknown>>}>,
  tenantId:string, actorId:string, write=false,
){
  const result=await query(
    'SELECT m.role FROM enterprise_tenant_memberships m '+
    'JOIN enterprise_tenants t ON t.id=m.tenant_id '+
    "WHERE m.tenant_id=$1 AND m.actor_id=$2 AND m.status='active' AND t.status='active' FOR SHARE OF m,t",
    [tenantId,actorId],
  );
  if(!result.rows.length)throw new ApiError(404,'NOT_FOUND','Empresa não encontrada no contexto autorizado.');
  const role=result.rows[0].role;
  if(write&&role!=='owner'&&role!=='admin')
    throw new ApiError(403,'FORBIDDEN','Sua função não permite cadastrar unidades empresariais.');
}

export async function GET(request:Request,route:Route){
  let ctx:RequestContext|undefined;
  try{
    ctx=requestContext(request);
    const tenantId=(await route.params).id;
    if(!z.string().uuid().safeParse(tenantId).success)throw new ApiError(400,'VALIDATION_FAILED','Empresa inválida.');
    const items=await database().transaction(async query=>{
      await guardMember(query,tenantId,ctx!.actorId);
      const r=await query(
        'SELECT id,code,name,tax_id AS "taxId",status FROM enterprise_legal_entities WHERE tenant_id=$1 ORDER BY code LIMIT 100',
        [tenantId],
      );
      return r.rows;
    });
    return respond({items},ctx);
  }catch(error){return failure(error,ctx);}
}

export async function POST(request:Request,route:Route){
  let ctx:RequestContext|undefined;
  try{
    ctx=requestContext(request,true);
    const tenantId=(await route.params).id;
    if(!z.string().uuid().safeParse(tenantId).success)throw new ApiError(400,'VALIDATION_FAILED','Empresa inválida.');
    const parsed=command.safeParse(await jsonBody(request));
    if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Dados da unidade empresarial inválidos.');
    const data=parsed.data;
    const hash=await fingerprint({actor:ctx.actorId,scope:'enterprise.legalEntity.create',tenantId,data});
    const result=await database().transaction(async query=>{
      await guardMember(query,tenantId,ctx!.actorId,true);
      const prior=await query(
        'SELECT actor_id,entity_type,entity_id,request_hash,result FROM business_commands WHERE id=$1 FOR UPDATE',
        [data.commandKey],
      );
      if(prior.rows.length){
        const prev=prior.rows[0];
        if(prev.actor_id!==ctx!.actorId||prev.entity_type!=='enterpriseLegalEntity'||prev.entity_id!==data.id||prev.request_hash!==hash)
          throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Chave já utilizada com outros dados.');
        return {...JSON.parse(String(prev.result)),replayed:true};
      }
      const now=new Date().toISOString();
      await query(
        'INSERT INTO enterprise_legal_entities(id,tenant_id,code,name,tax_id,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [data.id,tenantId,data.code,data.name,data.taxId??null,ctx!.actorId,now],
      );
      await query(
        "INSERT INTO enterprise_permission_events(id,tenant_id,actor_id,action,resource_id,correlation_id,created_at) VALUES($1,$2,$3,'legal_entity.created',$4,$5,$6)",
        [crypto.randomUUID(),tenantId,ctx!.actorId,data.id,ctx!.correlationId,now],
      );
      const receipt={id:data.id,tenantId,code:data.code,name:data.name,status:'active'};
      await query(
        "INSERT INTO business_commands(id,actor_id,entity_type,entity_id,command,request_hash,result,correlation_id,created_at) VALUES($1,$2,'enterpriseLegalEntity',$3,'create',$4,$5,$6,$7)",
        [data.commandKey,ctx!.actorId,data.id,hash,JSON.stringify(receipt),ctx!.correlationId,now],
      );
      return {...receipt,replayed:false};
    });
    return respond(result,ctx,result.replayed?200:201);
  }catch(error){return failure(error,ctx);}
}
