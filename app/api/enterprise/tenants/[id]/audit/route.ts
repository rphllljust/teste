import { z } from 'zod';
import { database } from '../../../../../../db/raw';
import { ApiError, failure, requestContext, respond, type RequestContext } from '../../../../../../lib/api/http';

export const dynamic = 'force-dynamic';

type Route = {params: Promise<{id:string}>};
const uuid = z.string().uuid();
const filter = z.object({
 pageSize:z.coerce.number().int().min(1).max(50).default(25),
 cursorAt:z.string().datetime({offset:true}).optional(),
 cursorId:uuid.optional(),
}).strict().refine(x => Boolean(x.cursorAt) === Boolean(x.cursorId), {
 message:'Paginação exige data e identificador do evento.',
});
type EventRow = {
 id:string;actorId:string;action:string;resourceId:string;
 correlationId:string;createdAt:string;
};

/**
 * Authenticated tenant-scoped permission audit.
 * This endpoint exposes only the immutable event history that the enterprise
 * membership commands actually write; it does not imply comprehensive GL,
 * document, or access-log coverage across unrelated ERP modules.
 */
export async function GET(request:Request,route:Route){
 let context:RequestContext|undefined;
 try{
  context=requestContext(request);
  const tenantId=(await route.params).id;
  if(!uuid.safeParse(tenantId).success)
   throw new ApiError(400,'VALIDATION_FAILED','Empresa inválida.');
  const parsed=filter.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if(!parsed.success)
   throw new ApiError(400,'VALIDATION_FAILED','Parâmetros de auditoria inválidos.');
  const f=parsed.data;
  const result=await database().transaction(async query=>{
   const membership=await query(
    "SELECT m.role FROM enterprise_tenants t JOIN enterprise_tenant_memberships m ON m.tenant_id=t.id "+
    "WHERE t.id=$1 AND t.status='active' AND m.actor_id=$2 AND m.status='active' FOR SHARE OF t,m",
    [tenantId,context!.actorId],
   );
   if(!membership.rows.length)
    throw new ApiError(404,'NOT_FOUND','Empresa indisponível no contexto autorizado.');
   const role=String(membership.rows[0].role);
   if(!['owner','admin','auditor'].includes(role))
    throw new ApiError(403,'FORBIDDEN','Perfil não autorizado para consultar auditoria de acessos.');
   const rows=await query(
    'SELECT id,actor_id AS "actorId",action,resource_id AS "resourceId",'+
    'correlation_id AS "correlationId",created_at AS "createdAt" '+
    'FROM enterprise_permission_events WHERE tenant_id=$1 '+
    'AND ($2::text IS NULL OR (created_at,id)<($2::text,$3::text)) '+
    'ORDER BY created_at DESC,id DESC LIMIT $4',
    [tenantId,f.cursorAt??null,f.cursorId??null,f.pageSize+1],
   );
   const items=(rows.rows as EventRow[]).slice(0,f.pageSize);
   const hasMore=rows.rows.length>f.pageSize;
   const last=hasMore?items[items.length-1]:undefined;
   return {tenantId,items,pageInfo:{
    pageSize:f.pageSize,hasMore,
    nextCursor:last?{cursorAt:last.createdAt,cursorId:last.id}:null,
   },source:'enterprise_permission_events'};
  });
  return respond(result,context);
 }catch(error){return failure(error,context);}
}
