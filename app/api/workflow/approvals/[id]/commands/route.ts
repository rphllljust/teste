import { z } from 'zod';
import { database } from '../../../../../../db/raw';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../../../lib/api/http';

const command = z.object({ key: z.string().uuid(), version: z.number().int().positive(), command: z.enum(['approve', 'reject']), reason: z.string().trim().min(3).max(500).optional() }).strict();

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request, true);
    const { id } = await route.params;
    if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, 'VALIDATION_FAILED', 'Solicitação de aprovação inválida.');
    const parsed = command.safeParse(await jsonBody(request));
    if (!parsed.success || (parsed.data.command === 'reject' && !parsed.data.reason)) throw new ApiError(400, 'VALIDATION_FAILED', 'Decisão ou justificativa inválida.');
    const input = parsed.data;
    const requestHash = await fingerprint({ actor: context.actorId, entityId: id, data: input });
    const db = database();
    const prior = await db.prepare('SELECT actor_id AS "actorId",request_hash AS "requestHash",to_state AS "toState",version FROM workflow_approval_events WHERE request_id=? AND id=?').bind(id, input.key).first<{ actorId: string; requestHash: string; toState: string; version: number }>();
    if (prior) {
      if (prior.actorId !== context.actorId || prior.requestHash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Chave de decisão já utilizada com outro conteúdo.');
      return respond({ id, state: prior.toState, rowVersion: prior.version, replayed: true }, context);
    }
    const result = await db.transaction(async query => {
      const selected = await query(`SELECT requested_by AS "requestedBy",approver_id AS "approverId",state,row_version AS "rowVersion",expected_version AS "expectedVersion",entity_type AS "entityType",entity_id AS "entityId" FROM workflow_approval_requests WHERE id=$1 FOR UPDATE`, [id]);
      const approval = selected.rows[0] as { requestedBy: string; approverId: string; state: string; rowVersion: number; expectedVersion: number; entityType: string; entityId: string } | undefined;
      if (!approval) throw new ApiError(404, 'APPROVAL_NOT_FOUND', 'Solicitação de aprovação não encontrada.');
      if (approval.approverId !== context!.actorId) throw new ApiError(403, 'APPROVER_NOT_AUTHORIZED', 'Usuário não autorizado para decidir esta solicitação.');
      if (approval.requestedBy === context!.actorId) throw new ApiError(409, 'SEGREGATION_OF_DUTIES', 'O solicitante não pode aprovar a própria operação.');
      if (approval.state !== 'pending') throw new ApiError(409, 'STATE_CONFLICT', 'A solicitação de aprovação já foi decidida.');
      if (approval.rowVersion !== input.version) throw new ApiError(409, 'VERSION_CONFLICT', 'A solicitação foi alterada; recarregue antes de decidir.');
      const nextState = input.command === 'approve' ? 'approved' : 'rejected';
      const now = new Date().toISOString();
      await query('UPDATE workflow_approval_requests SET state=$1,row_version=row_version+1,decided_at=$2 WHERE id=$3 AND state=\'pending\' AND row_version=$4', [nextState, now, id, input.version]);
      await query(`INSERT INTO workflow_approval_events (id,request_id,event_type,actor_id,from_state,to_state,version,request_hash,correlation_id,metadata,created_at)
        VALUES($1,$2,$3,$4,'pending',$5,$6,$7,$8,$9,$10)`, [input.key, id, input.command === 'approve' ? 'approved' : 'rejected', context!.actorId, nextState, input.version + 1, requestHash, context!.correlationId, JSON.stringify({ reason: input.reason ?? null, entityType: approval.entityType, entityId: approval.entityId, expectedVersion: approval.expectedVersion }), now]);
      return { id, state: nextState, rowVersion: input.version + 1, replayed: false };
    });
    return respond(result, context);
  } catch (error) { return failure(error, context); }
}
