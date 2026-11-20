import { z } from 'zod';
import { database } from '../../../../db/raw';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../lib/api/http';

const common = { id: z.string().uuid(), entityId: z.string().uuid(), expectedVersion: z.number().int().positive(), approverId: z.string().uuid() };
const submit = z.discriminatedUnion('entityType', [
  z.object({ ...common, entityType: z.literal('finance_period_close'), command: z.literal('close'), payload: z.object({ periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reference: z.string().trim().min(1).max(160) }).strict() }).strict(),
  z.object({ ...common, entityType: z.literal('service_order'), command: z.literal('authorize'), payload: z.object({ reason: z.string().trim().min(3).max(500).optional() }).strict() }).strict(),
  z.object({ ...common, entityType: z.literal('measurement'), command: z.literal('approve_measurement'), payload: z.object({ reason: z.string().trim().min(3).max(500).optional() }).strict() }).strict(),
]);

export async function POST(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request, true);
    const parsed = submit.safeParse(await jsonBody(request));
    if (!parsed.success || (parsed.data.entityType === 'finance_period_close' && parsed.data.payload.periodStart > parsed.data.payload.periodEnd)) throw new ApiError(400, 'VALIDATION_FAILED', 'A solicitação de aprovação financeira é inválida.');
    const data = parsed.data;
    if (data.approverId === context.actorId) throw new ApiError(409, 'SEGREGATION_OF_DUTIES', 'O solicitante não pode aprovar a própria operação.');
    const requestHash = await fingerprint({ actor: context.actorId, data });
    const now = new Date().toISOString();
    const db = database();
    const existing = await db.prepare('SELECT request_hash AS "requestHash",state,row_version AS "rowVersion" FROM workflow_approval_requests WHERE id=?').bind(data.id).first<{ requestHash: string; state: string; rowVersion: number }>();
    if (existing) {
      if (existing.requestHash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Identificador de aprovação já utilizado com outro conteúdo.');
      return respond({ id: data.id, state: existing.state, rowVersion: existing.rowVersion, replayed: true }, context);
    }
    const result = { id: data.id, entityType: data.entityType, entityId: data.entityId, command: data.command, state: 'pending', rowVersion: 1, approverId: data.approverId };
    await db.transaction(async query => {
      if (data.entityType === 'service_order') {
        const target = await query('SELECT status,version FROM service_orders WHERE id=$1 AND owner_id=$2 FOR SHARE', [data.entityId, context!.actorId]);
        const row = target.rows[0] as { status: string; version: number } | undefined;
        if (!row) throw new ApiError(404, 'NOT_FOUND', 'Ordem de serviço não encontrada no contexto autorizado.');
        if (row.status !== 'draft' || row.version !== data.expectedVersion) throw new ApiError(409, 'INVALID_STATE', 'A OS não está disponível para autorização na versão informada.');
      } else if (data.entityType === 'measurement') {
        const target = await query(`SELECT m.status,m.version FROM measurements m JOIN service_orders o ON o.id=m.order_id WHERE m.id=$1 AND o.owner_id=$2 FOR SHARE`, [data.entityId, context!.actorId]);
        const row = target.rows[0] as { status: string; version: number } | undefined;
        if (!row) throw new ApiError(404, 'NOT_FOUND', 'Medição não encontrada no contexto autorizado.');
        if (row.status !== 'draft' || row.version !== data.expectedVersion) throw new ApiError(409, 'INVALID_STATE', 'A medição não está disponível para aprovação na versão informada.');
      }
      await query(`INSERT INTO workflow_approval_requests (id,owner_id,entity_type,entity_id,command,state,requested_by,approver_id,expected_version,row_version,payload,request_hash,correlation_id,created_at)
        VALUES($1,$2,$3,$4,$5,'pending',$6,$7,$8,1,$9,$10,$11,$12)`, [data.id, context!.actorId, data.entityType, data.entityId, data.command, context!.actorId, data.approverId, data.expectedVersion, JSON.stringify(data.payload), requestHash, context!.correlationId, now]);
      await query(`INSERT INTO workflow_approval_events (id,request_id,event_type,actor_id,from_state,to_state,version,request_hash,correlation_id,metadata,created_at)
        VALUES($1,$2,'submitted',$3,NULL,'pending',1,$4,$5,$6,$7)`, [crypto.randomUUID(), data.id, context!.actorId, requestHash, context!.correlationId, JSON.stringify({ entityType: data.entityType, entityId: data.entityId, approverId: data.approverId }), now]);
    });
    return respond(result, context, 201);
  } catch (error) { return failure(error, context); }
}

const listQuery=z.object({
 state:z.enum(['pending','approved','rejected']).default('pending'),
 page:z.coerce.number().int().min(1).max(100000).default(1),
}).strict();

// The assigned approver may read their own inbox even when the request
// originated from a different owner. This does NOT grant access to the
// originating business record outside its normal tenant authorization.
export async function GET(request:Request){
 let context:RequestContext|undefined;
 try{
  context=requestContext(request);
  const parsed=listQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if(!parsed.success)throw new ApiError(400,'VALIDATION_FAILED','Consulta de aprovações inválida.');
  const {state,page}=parsed.data,db=database();
  const results=await db.snapshot([
   db.prepare(`SELECT id,entity_type AS "entityType",entity_id AS "entityId",
      command,state,requested_by AS "requestedBy",
      row_version AS "rowVersion",created_at AS "createdAt",
      decided_at AS "decidedAt"
     FROM workflow_approval_requests
     WHERE approver_id=? AND state=?
     ORDER BY created_at ASC,id ASC LIMIT 26 OFFSET ?`).bind(context.actorId,state,(page-1)*25),
   db.prepare('SELECT COUNT(*) AS total FROM workflow_approval_requests WHERE approver_id=? AND state=?')
    .bind(context.actorId,state),
  ]);
  return respond({items:results[0].results.slice(0,25),page,state,
    total:Number((results[1].results[0] as {total:number|string}).total),
    hasMore:results[0].results.length>25,
    authority:'assigned_approver_postgresql.v1'},context);
 }catch(error){return failure(error,context);}
}
