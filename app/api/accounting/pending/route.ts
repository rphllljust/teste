import { z } from 'zod';
import { database } from '../../../../db/raw';
import { ApiError, failure, fingerprint, requestContext, respond, type RequestContext } from '../../../../lib/api/http';
import { regularizeReceivableSettlementAccounting } from '../../../../lib/application/finance';

export const dynamic = 'force-dynamic';

const command = z.object({
  settlementId: z.string().uuid(),
  commandKey: z.string().uuid(),
}).strict();

export async function GET(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const rows = await database().prepare(`
      SELECT s.id AS "factId", s.kind, CAST(s.amount AS TEXT) AS "amountScaled",
             s.effective_date AS "effectiveDate", s.reference,
             CASE WHEN s.kind='receipt' THEN 'receivable_settlement' ELSE 'receivable_reversal' END AS "eventType",
             o.id AS "orderId", o.title AS "orderTitle",
             'receivable:' || s.id AS "source"
        FROM receivable_settlements s
        JOIN receivables r ON r.id=s.receivable_id
        JOIN invoices i ON i.id=r.invoice_id
        JOIN service_orders o ON o.id=i.order_id
       WHERE o.owner_id=?
         AND NOT EXISTS (
           SELECT 1 FROM journal_entries j
            WHERE j.actor_id=o.owner_id
              AND j.source_reference IN ('receivable_settlement:' || s.id, 'receivable_reversal:' || s.id)
         )
      UNION ALL
      SELECT p.id AS "factId", p.kind, CAST(p.amount AS TEXT) AS "amountScaled",
             p.effective_date AS "effectiveDate", p.reference,
             CASE WHEN p.kind='payment' THEN 'payable_payment' ELSE 'payable_reversal' END AS "eventType",
             NULL AS "orderId", NULL AS "orderTitle",
             'payable:' || p.id AS "source"
        FROM payable_payments p
       WHERE p.actor_id=?
         AND NOT EXISTS (
           SELECT 1 FROM journal_entries j
            WHERE j.actor_id=p.actor_id
              AND j.source_reference IN ('payable_payment:' || p.id, 'payable_reversal:' || p.id)
         )
       ORDER BY "effectiveDate" DESC, "factId" DESC
    `).bind(context.actorId, context.actorId).all();
    return respond({ items: rows.results }, context);
  } catch (error) {
    return failure(error, context);
  }
}

export async function POST(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request, true);
    const parsed = command.safeParse(await request.json());
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Fato financeiro inválido para regularização.');
    const value = parsed.data;
    const requestHash = await fingerprint({ actor: context.actorId, command: value });
    const result = await regularizeReceivableSettlementAccounting(context, value);
    return respond(result, context, result.replayed ? 200 : 201);
  } catch (error) {
    return failure(error, context);
  }
}
