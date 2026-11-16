import { z } from 'zod';
import { database } from '../../../../../db/raw';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../../lib/api/http';

const command = z.object({ id: z.string().uuid(), periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reference: z.string().trim().min(1).max(160) }).strict();

export async function POST(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request, true);
    const parsed = command.safeParse(await jsonBody(request));
    if (!parsed.success || parsed.data.periodStart > parsed.data.periodEnd) throw new ApiError(400, 'VALIDATION_FAILED', 'Período de fechamento inválido.');
    const data = parsed.data;
    const requestHash = await fingerprint({ actor: context.actorId, data });
    const db = database();
    const prior = await db.prepare('SELECT id,request_hash FROM finance_period_closes WHERE id=? AND actor_id=?').bind(data.id, context.actorId).first<{ id: string; request_hash: string }>();
    if (prior) { if (prior.request_hash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Identificador de fechamento já utilizado.'); return respond({ id: data.id, replayed: true }, context); }
    const overlap = await db.prepare("SELECT id FROM finance_period_closes WHERE actor_id=? AND status='closed' AND period_start<=? AND period_end>=? LIMIT 1").bind(context.actorId, data.periodEnd, data.periodStart).first();
    if (overlap) throw new ApiError(409, 'FINANCE_PERIOD_OVERLAP', 'O período informado se sobrepõe a um período já fechado.');
    await db.transaction(async query => {
      await query('INSERT INTO finance_period_closes (id,period_start,period_end,status,actor_id,request_hash,correlation_id,closed_at) VALUES ($1,$2,$3,\'closed\',$4,$5,$6,$7)', [data.id, data.periodStart, data.periodEnd, context!.actorId, requestHash, context!.correlationId, new Date().toISOString()]);
      await query(`INSERT INTO finance_audit_events (id,entity_type,entity_id,action,actor_id,request_hash,correlation_id,metadata,occurred_at) VALUES ($1,'finance_period',$2,'period_closed',$3,$4,$5,$6,$7)`, [crypto.randomUUID(), data.id, context!.actorId, requestHash, context!.correlationId, JSON.stringify({ periodStart: data.periodStart, periodEnd: data.periodEnd, reference: data.reference }), new Date().toISOString()]);
    });
    return respond({ id: data.id, periodStart: data.periodStart, periodEnd: data.periodEnd, status: 'closed' }, context, 201);
  } catch (error) { return failure(error, context); }
}
