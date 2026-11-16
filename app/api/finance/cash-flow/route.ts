import { z } from 'zod';
import { database } from '../../../../db/raw';
import { ApiError, failure, requestContext, respond, type RequestContext } from '../../../../lib/api/http';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function GET(request: Request) {
  let context: ReturnType<typeof requestContext> | undefined;
  try {
    context = requestContext(request);
    const url = new URL(request.url);
    const asOf = url.searchParams.get('asOf') ?? new Date().toISOString().slice(0, 10);
    const from = url.searchParams.get('from') ?? asOf;
    const to = url.searchParams.get('to') ?? new Date(Date.parse(`${asOf}T00:00:00Z`) + 30 * 86400000).toISOString().slice(0, 10);
    if (!date.safeParse(asOf).success || !date.safeParse(from).success || !date.safeParse(to).success || from > to) throw new ApiError(400, 'VALIDATION_FAILED', 'Período de fluxo de caixa inválido.');
    const db = database();
    const results = await db.batch([
      db.prepare(`SELECT r.due_date AS date,'receivable' AS kind,CAST((r.amount-COALESCE((SELECT SUM(CASE WHEN s.kind='receipt' THEN s.amount ELSE -s.amount END) FROM receivable_settlements s WHERE s.receivable_id=r.id),0)) AS TEXT) AS amount FROM receivables r JOIN invoices i ON i.id=r.invoice_id JOIN service_orders o ON o.id=i.order_id WHERE o.owner_id=? AND r.due_date BETWEEN ? AND ? AND r.amount-COALESCE((SELECT SUM(CASE WHEN s.kind='receipt' THEN s.amount ELSE -s.amount END) FROM receivable_settlements s WHERE s.receivable_id=r.id),0)>0`).bind(context.actorId, from, to),
      db.prepare(`SELECT due_date AS date,'payable' AS kind,CAST((amount-COALESCE((SELECT SUM(CASE WHEN s.kind='payment' THEN s.amount ELSE -s.amount END) FROM payable_payments s WHERE s.payable_id=p.id),0)) AS TEXT) AS amount FROM payables p WHERE actor_id=? AND due_date BETWEEN ? AND ? AND amount-COALESCE((SELECT SUM(CASE WHEN s.kind='payment' THEN s.amount ELSE -s.amount END) FROM payable_payments s WHERE s.payable_id=p.id),0)>0`).bind(context.actorId, from, to),
      db.prepare(`SELECT s.effective_date AS date,'receipt' AS kind,CAST(s.amount AS TEXT) AS amount FROM receivable_settlements s JOIN receivables r ON r.id=s.receivable_id JOIN invoices i ON i.id=r.invoice_id JOIN service_orders o ON o.id=i.order_id WHERE o.owner_id=? AND s.effective_date BETWEEN ? AND ?`).bind(context.actorId, from, to),
      db.prepare(`SELECT effective_date AS date,'payment' AS kind,CAST(amount AS TEXT) AS amount FROM payable_payments WHERE actor_id=? AND effective_date BETWEEN ? AND ?`).bind(context.actorId, from, to),
      db.prepare(`SELECT CAST(closing_balance AS TEXT) AS amount FROM bank_statements WHERE actor_id=? ORDER BY period_end DESC,id DESC LIMIT 1`).bind(context.actorId),
    ]);
    const buckets = new Map<string, { date: string; projectedIn: number; projectedOut: number; realizedIn: number; realizedOut: number }>();
    const bucket = (day: string) => { const value = buckets.get(day) ?? { date: day, projectedIn: 0, projectedOut: 0, realizedIn: 0, realizedOut: 0 }; buckets.set(day, value); return value; };
    for (const row of results[0].results as Array<{ date: string; amount: string }>) bucket(row.date).projectedIn += Number(row.amount);
    for (const row of results[1].results as Array<{ date: string; amount: string }>) bucket(row.date).projectedOut += Number(row.amount);
    for (const row of results[2].results as Array<{ date: string; amount: string }>) { const value = bucket(row.date); value.realizedIn += Number(row.amount); }
    for (const row of results[3].results as Array<{ date: string; amount: string }>) { const value = bucket(row.date); value.realizedOut += Number(row.amount); }
    const items = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date)).map(row => ({ ...row, netProjected: row.projectedIn - row.projectedOut, netRealized: row.realizedIn - row.realizedOut }));
    const summary = items.reduce((acc, row) => ({ projectedIn: acc.projectedIn + row.projectedIn, projectedOut: acc.projectedOut + row.projectedOut, realizedIn: acc.realizedIn + row.realizedIn, realizedOut: acc.realizedOut + row.realizedOut }), { projectedIn: 0, projectedOut: 0, realizedIn: 0, realizedOut: 0 });
    return respond({ asOf, from, to, openingBankBalanceScaled: String((results[4].results[0] as { amount?: string })?.amount ?? '0'), items, summary: { ...summary, netProjected: summary.projectedIn - summary.projectedOut, netRealized: summary.realizedIn - summary.realizedOut }, authorities: { projected: 'open_titles.due_date.v1', realized: 'settlement_ledgers.effective_date.v1', bank: 'latest_imported_statement.v1' }, warnings: ['Fluxo projetado não representa saldo bancário disponível.'] }, context);
  } catch (error) { return failure(error, context); }
}
