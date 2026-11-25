import { z } from 'zod';
import { database } from '../../../../db/raw';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../lib/api/http';

export const dynamic='force-dynamic';
const command=z.object({
  id:z.string().uuid(), commandKey:z.string().uuid(),
  slug:z.string().regex(/^[a-z][a-z0-9-]{2,47}$/),
  name:z.string().trim().min(3).max(160),
}).strict();

export async function GET(request:Request){
  let ctx:RequestContext|undefined;
  try{
    ctx=requestContext(request);
    const result=await database().prepare(
      'SELECT t.id,t.slug,t.name,t.status,m.role,t.row_version AS "rowVersion" '+
      'FROM enterprise_tenants t JOIN enterprise_tenant_memberships m ON m.tenant_id=t.id '+
      "WHERE m.actor_id=? AND m.status='active' AND t.status='active' "+
      'ORDER BY t.created_at DESC,t.id DESC LIMIT 100',
    ).bind(ctx.actorId).all();
    return respond({items:result.results},ctx);
  }catch(error){return failure(error,ctx);}
}

export async function POST(request:Request){
  let ctx:RequestContext|undefined;
  try{
    ctx=requestContext(request,true);
    const parsed=command.safeParse(await jsonBody(request));
    if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Dados empresariais inválidos.');
    const data=parsed.data;
    const hash=await fingerprint({actor:ctx.actorId,scope:'enterprise.tenant.create',data});
    const result=await database().transaction(async query=>{
      const prior=await query(
        'SELECT actor_id,entity_type,request_hash,result FROM business_commands WHERE id=$1 FOR UPDATE',
        [data.commandKey],
      );
      if(prior.rows.length){
        const previous=prior.rows[0];
        if(previous.actor_id!==ctx!.actorId||previous.entity_type!=='enterpriseTenant'||previous.request_hash!==hash)
          throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Chave de operação já utilizada.');
        return {...JSON.parse(String(previous.result)),replayed:true};
      }
      const now=new Date().toISOString();
      await query(
        'INSERT INTO enterprise_tenants(id,slug,name,created_by,created_at) VALUES($1,$2,$3,$4,$5)',
        [data.id,data.slug,data.name,ctx!.actorId,now],
      );
      await query(
        "INSERT INTO enterprise_tenant_memberships(tenant_id,actor_id,role,created_at) VALUES($1,$2,'owner',$3)",
        [data.id,ctx!.actorId,now],
      );
      await query(
        "INSERT INTO enterprise_permission_events(id,tenant_id,actor_id,action,resource_id,correlation_id,created_at) VALUES($1,$2,$3,'tenant.created',$2,$4,$5)",
        [crypto.randomUUID(),data.id,ctx!.actorId,ctx!.correlationId,now],
      );
      const receipt={id:data.id,slug:data.slug,name:data.name,status:'active',role:'owner'};
      await query(
        "INSERT INTO business_commands(id,actor_id,entity_type,entity_id,command,request_hash,result,correlation_id,created_at) VALUES($1,$2,'enterpriseTenant',$3,'create',$4,$5,$6,$7)",
        [data.commandKey,ctx!.actorId,data.id,hash,JSON.stringify(receipt),ctx!.correlationId,now],
      );
      return {...receipt,replayed:false};
    });
    return respond(result,ctx,result.replayed?200:201);
  }catch(error){return failure(error,ctx);}
}
