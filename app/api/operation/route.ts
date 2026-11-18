import { failure, requestContext, respond, type RequestContext } from '../../../lib/api/http';
import { parseLinked } from '../../../lib/api/query';
import { database } from '../../../db/raw';
import { operationMetrics, operationQuery, projectLinked } from '../../../lib/projections/operation';

export async function GET(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const p = parseLinked(request);
    const q = operationQuery(p, context.actorId);
    const db = database();
    const results = await db.batch([
      db.prepare(`SELECT ${q.columns} FROM ${q.from}${q.where} ORDER BY ${q.sort} LIMIT ? OFFSET ?`)
        .bind(...q.values, p.pageSize + 1, (p.page - 1) * p.pageSize),
      db.prepare(`SELECT COUNT(*) AS total,CAST(COALESCE(SUM(${q.alias}.amount),0) AS TEXT) AS amount${q.balanceExpression ? `,CAST(COALESCE(SUM(${q.balanceExpression}),0) AS TEXT) AS balance` : ''} FROM ${q.from}${q.where}`)
        .bind(...q.values),
      db.prepare(`SELECT COUNT(*) AS source_total FROM ${q.from} WHERE (o.owner_id IS NULL OR o.owner_id=?)`).bind(context.actorId),
    ]);
    const rows = results[0].results as Array<Record<string, unknown>>;
    const aggregate = (results[1].results[0] ?? {}) as { total?: number | string; amount?: string | null; balance?: string | null };
    const source = (results[2].results[0] ?? {}) as { source_total?: number | string };
    const generatedAt = new Date().toISOString();
    return respond({
      measurements: p.kind === 'measurements' ? rows.slice(0, p.pageSize).map(row => projectLinked(row as never, p.kind)) : [],
      invoices: p.kind === 'invoices' ? rows.slice(0, p.pageSize).map(row => projectLinked(row as never, p.kind)) : [],
      receivables: p.kind === 'receivables' ? rows.slice(0, p.pageSize).map(row => projectLinked(row as never, p.kind)) : [],
      pageInfo: { page: p.page, pageSize: p.pageSize, total: Number(aggregate.total ?? 0), sourceTotal: Number(source.source_total ?? 0), hasMore: rows.length > p.pageSize },
      aggregates: operationMetrics(p, { total: Number(aggregate.total ?? 0), amount: aggregate.amount ?? null, balance: aggregate.balance ?? null }, generatedAt),
      generatedAt,
    }, context);
  } catch (error) {
    return failure(error, context);
  }
}
