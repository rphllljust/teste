import { z } from 'zod';
import { database } from '../../../../db/raw';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../lib/api/http';

export const dynamic = 'force-dynamic';

const eventType = z.enum([
  'receivable_settlement',
  'receivable_reversal',
  'payable_payment',
  'payable_reversal',
]);
const input = z.object({
  id: z.string().uuid(),
  eventType,
  debitAccountId: z.string().uuid(),
  creditAccountId: z.string().uuid(),
}).strict().superRefine((value, ctx) => {
  if (value.debitAccountId === value.creditAccountId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['creditAccountId'], message: 'As contas devem ser diferentes.' });
  }
});

export async function GET(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const rows = await database().prepare(
      'SELECT id,event_type AS "eventType",debit_account_id AS "debitAccountId",credit_account_id AS "creditAccountId",active,created_at AS "createdAt" FROM accounting_event_rules WHERE actor_id=? ORDER BY event_type,id',
    ).bind(context.actorId).all();
    return respond({ items: rows.results }, context);
  } catch (error) {
    return failure(error, context);
  }
}

export async function POST(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request, true);
    const parsed = input.safeParse(await jsonBody(request));
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Regra contábil inválida.');
    const value = parsed.data;
    const requestHash = await fingerprint({ actor: context.actorId, rule: value });
    let replayed = false;
    await database().transaction(async query => {
      const accounts = await query(
        'SELECT id FROM chart_accounts WHERE actor_id=? AND active=1 AND id IN (?,?)',
        [context!.actorId, value.debitAccountId, value.creditAccountId],
      );
      if (accounts.rows.length !== 2) {
        throw new ApiError(409, 'ACCOUNT_UNAVAILABLE', 'As contas devem existir e pertencer ao contexto atual.');
      }
      const prior = await query(
        'SELECT id,request_hash FROM accounting_event_rules WHERE id=? AND actor_id=? FOR UPDATE',
        [value.id, context!.actorId],
      );
      if (prior.rows.length) {
        if (prior.rows[0].request_hash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'A regra já existe com outro conteúdo.');
        replayed = true;
        return;
      }
      await query(
        'INSERT INTO accounting_event_rules(id,actor_id,event_type,debit_account_id,credit_account_id,active,created_at,request_hash,correlation_id) VALUES(?,?,?,?,?,true,?,?,?,?)',
        [value.id, context!.actorId, value.eventType, value.debitAccountId, value.creditAccountId, new Date().toISOString(), requestHash, context!.correlationId],
      );
    });
    return respond({ ok: true, item: value, replayed }, context, replayed ? 200 : 201);
  } catch (error) {
    return failure(error, context);
  }
}
