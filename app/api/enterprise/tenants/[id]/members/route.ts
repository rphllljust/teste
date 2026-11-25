import { z } from 'zod';
import { database } from '../../../../../../db/raw';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../../../lib/api/http';

export const dynamic='force-dynamic';
type Route={params:Promise<{id:string}>};
const target=z.string().trim().min(8).max(200).regex(/^[a-zA-Z0-9_.:@-]+$/);
const command=z.discriminatedUnion('action',[
  z.object({commandKey:z.string().uuid(),action:z.literal('provision'),actorId:target,
    role:z.enum(['admin','accountant','operator','auditor'])}).strict(),
  z.object({commandKey:z.string().uuid(),action:z.literal('deactivate'),actorId:target}).strict(),
]);
type Query=(statement:string,bindings?:unknown[])=>Promise<{rows:Array<Record<string,unknown>>;rowCount:number}>;

/** The actor is always authenticated by requestContext, never from submitted roles/headers. */
async function authorize(query:Query,tenantId:string,actorId:string,write:boolean){
  const rows=await query(
    "SELECT t.id,m.role FROM enterprise_tenants t "+
    "JOIN enterprise_tenant_memberships m ON m.tenant_id=t.id "+
    "WHERE t.id=$1 AND m.actor_id=$2 AND m.status='active' AND t.status='active' FOR SHARE OF t,m",
    [tenantId,actorId],
  );
  if(!rows.rows.length)throw new ApiError(404,'NOT_FOUND','Empresa indisponível no contexto autorizado.');
  const role=String(rows.rows[0].role);
  if(write&&role!=='owner')throw new ApiError(403,'FORBIDDEN','Somente o proprietário pode administrar acessos.');
  if(!write&&role!=='owner'&&role!=='admin')throw new ApiError(403,'FORBIDDEN','Sem permissão para consultar a equipe.');
}

export async function GET(request:Request,route:Route){
  let ctx:RequestContext|undefined;
  try{
    ctx=requestContext(request);
    const tenantId=(await route.params).id;
    if(!z.string().uuid().safeParse(tenantId).success)throw new ApiError(400,'VALIDATION_FAILED','Empresa inválida.');
    const rows=await database().transaction(async query=>{
      await authorize(query,tenantId,ctx!.actorId,false);
      return query(
        'SELECT actor_id AS "actorId",role,status,created_at AS "createdAt" '+
        'FROM enterprise_tenant_memberships WHERE tenant_id=$1 ORDER BY created_at,actor_id LIMIT 100',[tenantId],
      );
    });
    return respond({items:rows.rows},ctx);
  }catch(error){return failure(error,ctx);}
}

export async function POST(request:Request,route:Route){
  let ctx:RequestContext|undefined;
  try{
    ctx=requestContext(request,true);
    const tenantId=(await route.params).id;
    if(!z.string().uuid().safeParse(tenantId).success)throw new ApiError(400,'VALIDATION_FAILED','Empresa inválida.');
    const parsed=command.safeParse(await jsonBody(request));
    if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Ação de acesso inválida.');
    const data=parsed.data;
    if(data.actorId===ctx.actorId)throw new ApiError(409,'SEGREGATION_OF_DUTIES','Não é permitido alterar o próprio acesso.');
    const hash=await fingerprint({actor:ctx.actorId,scope:'enterprise.membership',tenantId,data});
    const result=await database().transaction(async query=>{
      await authorize(query,tenantId,ctx!.actorId,true);
      const prior=await query(
        'SELECT actor_id,entity_type,entity_id,request_hash,result FROM business_commands WHERE id=$1 FOR UPDATE',[data.commandKey],
      );
      if(prior.rows.length){
        const row=prior.rows[0];
        if(row.actor_id!==ctx!.actorId||row.entity_type!=='enterpriseMembership'||
           row.entity_id!==tenantId||row.request_hash!==hash)
          throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Chave já utilizada.');
        return {...JSON.parse(String(row.result)),replayed:true};
      }
      // Serialize role decisions for this membership and avoid status toggles racing.
      const member=await query(
        'SELECT role,status FROM enterprise_tenant_memberships WHERE tenant_id=$1 AND actor_id=$2 FOR UPDATE',
        [tenantId,data.actorId],
      );
      const now=new Date().toISOString();
      if(data.action==='provision'){
        if(member.rows.length)throw new ApiError(409,'MEMBERSHIP_ALREADY_EXISTS','O vínculo já existe. Reativação exige procedimento próprio.');
        await query(
          'INSERT INTO enterprise_tenant_memberships(tenant_id,actor_id,role,created_at) VALUES($1,$2,$3,$4)',
          [tenantId,data.actorId,data.role,now],
        );
      }else{
        if(!member.rows.length||member.rows[0].status!=='active')
          throw new ApiError(404,'NOT_FOUND','Vínculo ativo não encontrado.');
        if(member.rows[0].role==='owner')
          throw new ApiError(409,'LAST_OWNER_PROTECTED','Não é permitido desativar proprietários.');
        await query(
          "UPDATE enterprise_tenant_memberships SET status='inactive' WHERE tenant_id=$1 AND actor_id=$2",
          [tenantId,data.actorId],
        );
      }
      await query(
        'INSERT INTO enterprise_permission_events(id,tenant_id,actor_id,action,resource_id,correlation_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [crypto.randomUUID(),tenantId,ctx!.actorId,
          data.action==='provision'?'membership.provisioned':'membership.deactivated',
          data.actorId,ctx!.correlationId,now],
      );
      const receipt={
        tenantId,actorId:data.actorId,role:data.action==='provision'?data.role:String(member.rows[0].role),
        status:data.action==='provision'?'active':'inactive',
      };
      await query(
        "INSERT INTO business_commands(id,actor_id,entity_type,entity_id,command,request_hash,result,correlation_id,created_at) VALUES($1,$2,'enterpriseMembership',$3,$4,$5,$6,$7,$8)",
        [data.commandKey,ctx!.actorId,tenantId,data.action,hash,JSON.stringify(receipt),ctx!.correlationId,now],
      );
      return {...receipt,replayed:false};
    });
    return respond(result,ctx,result.replayed?200:201);
  }catch(error){return failure(error,ctx);}
}
