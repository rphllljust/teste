import { z } from 'zod';
import { database } from '../../../../db/raw';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../lib/api/http';

const submit = z.object({
  id: z.string().uuid(), entityType: z.literal('finance_period_close'), entityId: z.string().uuid(), command: z.literal('close'),
  expectedVersion: z.number().int().positive(), approverId: z.string().uuid(),
  payload: z.object({ periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reference: z.string().trim().min(1).max(160) }).strict(),
}).strict();

export async function POST(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request, true);
    const parsed = submit.safeParse(await jsonBody(request));
    if (!parsed.success || parsed.data.payload.periodStart > parsed.data.payload.periodEnd) throw new ApiError(400, 'VALIDATION_FAILED', 'A solicitação de aprovação financeira é inválida.');
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
      await query(`INSERT INTO workflow_approval_requests (id,owner_id,entity_type,entity_id,command,state,requested_by,approver_id,expected_version,row_version,payload,request_hash,correlation_id,created_at)
        VALUES($1,$2,$3,$4,$5,'pending',$6,$7,$8,1,$9,$10,$11,$12)`, [data.id, context!.actorId, data.entityType, data.entityId, data.command, context!.actorId, data.approverId, data.expectedVersion, JSON.stringify(data.payload), requestHash, context!.correlationId, now]);
      await query(`INSERT INTO workflow_approval_events (id,request_id,event_type,actor_id,from_state,to_state,version,request_hash,correlation_id,metadata,created_at)
        VALUES($1,$2,'submitted',$3,NULL,'pending',1,$4,$5,$6,$7)`, [crypto.randomUUID(), data.id, context!.actorId, requestHash, context!.correlationId, JSON.stringify({ entityType: data.entityType, entityId: data.entityId, approverId: data.approverId }), now]);
    });
    return respond(result, context, 201);
  } catch (error) { return failure(error, context); }
}
