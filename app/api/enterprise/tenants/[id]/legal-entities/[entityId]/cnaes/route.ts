import { z } from 'zod';
import { database } from '../../../../../../../../db/raw';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../../../../../lib/api/http';

export const dynamic = 'force-dynamic';
type Route = { params: Promise<{ id: string; entityId: string }> };
type Query = (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
const command = z.object({
  commandKey: z.string().uuid(),
  action: z.literal('applyDeclaredProfile'),
}).strict();

async function authorize(query: Query, tenantId: string, entityId: string, actorId: string, write: boolean) {
  const r = await query(
    'SELECT m.role,e.id FROM enterprise_tenants t ' +
    'JOIN enterprise_tenant_memberships m ON m.tenant_id=t.id ' +
    'JOIN enterprise_legal_entities e ON e.tenant_id=t.id ' +
    "WHERE t.id=$1 AND e.id=$2 AND m.actor_id=$3 AND m.status='active' " +
    "AND t.status='active' AND e.status='active' " +
    (write ? 'FOR UPDATE OF e FOR SHARE OF m,t' : 'FOR SHARE OF e,m,t'),
    [tenantId, entityId, actorId],
  );
  if (!r.rows.length)
    throw new ApiError(404, 'NOT_FOUND', 'Empresa jurídica indisponível neste contexto autorizado.');
  const role = String(r.rows[0].role);
  if (write && role !== 'owner' && role !== 'admin')
    throw new ApiError(403, 'FORBIDDEN', 'Somente proprietários e administradores podem registrar CNAEs.');
}

function routeIds(params: { id: string; entityId: string }) {
  if (!z.string().uuid().safeParse(params.id).success ||
      !z.string().uuid().safeParse(params.entityId).success)
    throw new ApiError(400, 'VALIDATION_FAILED', 'Identificação empresarial inválida.');
  return { tenantId: params.id, entityId: params.entityId };
}

export async function GET(request: Request, route: Route) {
  let ctx: RequestContext | undefined;
  try {
    ctx = requestContext(request);
    const {tenantId,entityId}=routeIds(await route.params);
    const result = await database().transaction(async query => {
      await authorize(query, tenantId, entityId, ctx!.actorId, false);
      const catalog = await query(
        'SELECT code,description,is_primary AS "isPrimary" ' +
        'FROM enterprise_declared_cnaes ORDER BY display_order'
      );
      const linked = await query(
        'SELECT c.code,c.description,a.is_primary AS "isPrimary" ' +
        'FROM enterprise_legal_entity_cnaes a ' +
        'JOIN enterprise_declared_cnaes c ON c.code=a.cnae_code ' +
        'WHERE a.tenant_id=$1 AND a.legal_entity_id=$2 ORDER BY c.display_order',
        [tenantId,entityId]
      );
      return { items: linked.rows, declaredProfile: catalog.rows };
    });
    return respond(result,ctx);
  } catch (error) { return failure(error,ctx); }
}

export async function POST(request: Request, route: Route) {
  let ctx: RequestContext | undefined;
  try {
    ctx = requestContext(request,true);
    const {tenantId,entityId}=routeIds(await route.params);
    const parsed = command.safeParse(await jsonBody(request));
    if (!parsed.success)
      throw new ApiError(400,'VALIDATION_FAILED','Comando de atividades inválido.');
    const data=parsed.data;
    const hash=await fingerprint({
      actor:ctx.actorId,scope:'enterprise.legalEntity.cnaes.applyDeclaredProfile',
      tenantId,entityId,data,
    });
    const result=await database().transaction(async query => {
      // Locks the company row so concurrent imports cannot race; membership
      // and company scope are verified from the authenticated identity.
      await authorize(query,tenantId,entityId,ctx!.actorId,true);
      const prior=await query(
        'SELECT actor_id,entity_type,entity_id,request_hash,result ' +
        'FROM business_commands WHERE id=$1 FOR UPDATE',
        [data.commandKey],
      );
      if(prior.rows.length){
        const p=prior.rows[0];
        if(p.actor_id!==ctx!.actorId||p.entity_type!=='enterpriseLegalEntityCnaeProfile'||
           p.entity_id!==entityId||p.request_hash!==hash)
          throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Chave já utilizada com outros dados.');
        return {...JSON.parse(String(p.result)),replayed:true};
      }
      const existing=await query(
        'SELECT COUNT(*)::integer AS count FROM enterprise_legal_entity_cnaes ' +
        'WHERE tenant_id=$1 AND legal_entity_id=$2',[tenantId,entityId],
      );
      if(Number(existing.rows[0].count)>0)
        throw new ApiError(409,'CNAE_PROFILE_EXISTS',
          'Esta empresa já possui CNAEs vinculados. O cadastro existente foi preservado.');
      const catalog=await query(
        'SELECT COUNT(*)::integer AS count, ' +
        'COUNT(*) FILTER(WHERE is_primary)::integer AS primary_count ' +
        'FROM enterprise_declared_cnaes'
      );
      if(Number(catalog.rows[0].count)!==49||Number(catalog.rows[0].primary_count)!==1)
        throw new ApiError(503,'CATALOG_UNAVAILABLE','Catálogo de atividades incompleto.');
      const now=new Date().toISOString();
      const inserted=await query(
        'INSERT INTO enterprise_legal_entity_cnaes ' +
        '(tenant_id,legal_entity_id,cnae_code,is_primary,created_by,created_at) ' +
        'SELECT $1,$2,code,is_primary,$3,$4 FROM enterprise_declared_cnaes ' +
        'RETURNING cnae_code,is_primary',
        [tenantId,entityId,ctx!.actorId,now],
      );
      if(inserted.rows.length!==49)
        throw new ApiError(503,'CATALOG_UNAVAILABLE','Cadastro incompleto. Nenhuma alteração foi aplicada.');
      await query(
        "INSERT INTO enterprise_permission_events " +
        "(id,tenant_id,actor_id,action,resource_id,correlation_id,created_at) " +
        "VALUES($1,$2,$3,'legal_entity.cnaes.registered',$4,$5,$6)",
        [crypto.randomUUID(),tenantId,ctx!.actorId,entityId,ctx!.correlationId,now],
      );
      const receipt={tenantId,entityId,count:inserted.rows.length,primaryCode:'46.19-2-00'};
      await query(
        'INSERT INTO business_commands ' +
        '(id,actor_id,entity_type,entity_id,command,request_hash,result,correlation_id,created_at) ' +
        "VALUES($1,$2,'enterpriseLegalEntityCnaeProfile',$3,'applyDeclaredProfile',$4,$5,$6,$7)",
        [data.commandKey,ctx!.actorId,entityId,hash,JSON.stringify(receipt),ctx!.correlationId,now],
      );
      return {...receipt,replayed:false};
    });
    return respond(result,ctx,result.replayed?200:201);
  } catch(error){return failure(error,ctx);}
}
