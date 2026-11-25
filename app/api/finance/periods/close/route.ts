import { z } from 'zod';
import { database } from '../../../../../db/raw';
import { assertPeriodReadyToClose, lockFinancePeriodScope } from '../../../../../lib/application/finance';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, validDate, type RequestContext } from '../../../../../lib/api/http';

const command = z.object({ id: z.string().uuid(), periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reference: z.string().trim().min(1).max(160) }).strict();

export async function GET(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));
    const db = database();
    const result = await db.prepare(`SELECT p.id,p.period_start AS "periodStart",p.period_end AS "periodEnd",p.status,p.closed_at AS "closedAt",COALESCE((SELECT a.metadata::jsonb->>'reference' FROM finance_audit_events a WHERE a.entity_type='finance_period' AND a.entity_id=p.id AND a.action='period_closed' ORDER BY a.occurred_at DESC LIMIT 1),'') AS reference FROM finance_period_closes p WHERE p.actor_id=? ORDER BY p.period_end DESC,p.id DESC LIMIT 26 OFFSET ?`).bind(context.actorId, (page - 1) * 25).all();
    return respond({ items: result.results.slice(0, 25), pageInfo: { hasMore: result.results.length > 25 } }, context);
  } catch (error) { return failure(error, context); }
}

export async function POST(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request, true);
    const parsed = command.safeParse(await jsonBody(request));
    if (!parsed.success || !validDate(parsed.data.periodStart) ||
        !validDate(parsed.data.periodEnd) || parsed.data.periodStart > parsed.data.periodEnd)
      throw new ApiError(400, 'VALIDATION_FAILED', 'Período de fechamento inválido.');
    const data = parsed.data;
    const requestHash = await fingerprint({ actor: context.actorId, data });
    const result = await database().transaction(async query => {
      await lockFinancePeriodScope(query, context!.actorId);
      const prior = await query(
        'SELECT actor_id,request_hash FROM finance_period_closes WHERE id=$1 FOR UPDATE', [data.id],
      );
      if (prior.rows.length) {
        if (prior.rows[0].actor_id !== context!.actorId || prior.rows[0].request_hash !== requestHash)
          throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Identificador de fechamento já utilizado.');
        return { id: data.id, replayed: true };
      }
      const overlap = await query(
        "SELECT id FROM finance_period_closes WHERE actor_id=$1 AND status='closed' AND period_start<=$2 AND period_end>=$3 LIMIT 1",
        [context!.actorId, data.periodEnd, data.periodStart],
      );
      if (overlap.rows.length)
        throw new ApiError(409, 'FINANCE_PERIOD_OVERLAP', 'O período informado se sobrepõe a um período já fechado.');
      const closeGate = await assertPeriodReadyToClose(query,context!.actorId,data.periodStart,data.periodEnd);
      const now = new Date().toISOString();
      await query(
        "INSERT INTO finance_period_closes(id,period_start,period_end,status,actor_id,request_hash,correlation_id,closed_at) VALUES($1,$2,$3,'closed',$4,$5,$6,$7)",
        [data.id, data.periodStart, data.periodEnd, context!.actorId, requestHash, context!.correlationId, now],
      );
      await query(
        "INSERT INTO finance_audit_events(id,entity_type,entity_id,action,actor_id,request_hash,correlation_id,metadata,occurred_at) VALUES($1,'finance_period',$2,'period_closed',$3,$4,$5,$6,$7)",
        [crypto.randomUUID(),data.id,context!.actorId,requestHash,context!.correlationId,
          JSON.stringify({periodStart:data.periodStart,periodEnd:data.periodEnd,reference:data.reference,closeGate}),now],
      );
      return { id:data.id, periodStart:data.periodStart, periodEnd:data.periodEnd, status:'closed', replayed:false };
    });
    return respond(result, context, result.replayed ? 200 : 201);
  } catch (error) { return failure(error, context); }
}
