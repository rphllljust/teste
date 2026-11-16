import { z } from 'zod';
import { database } from '../../../db/raw';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../lib/api/http';
import { payableList, payableQuery, payableBalance, paidExpression } from '../../../lib/projections/payables';

const money = z.string().trim().regex(/^\d{1,12}(?:[,.]\d{1,4})?$/).transform(value => { const [whole, fraction = ''] = value.split(/[,.]/); return Number(whole) * 10000 + Number(fraction.padEnd(4, '0')); }).refine(value => value > 0 && value <= 1_000_000_000_000);
const createCommand = z.object({ id: z.string().uuid(), supplier: z.string().trim().min(2).max(160), sourceReference: z.string().trim().min(3).max(160), description: z.string().trim().min(3).max(4000), amount: money, dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();

export async function GET(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const parsed = payableList.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Filtro financeiro inválido.');
    const p = parsed.data;
    const db = database();
    const q = payableQuery(p, context.actorId);
    const columns = `p.id,p.supplier,p.source_reference AS "sourceReference",p.description,CAST(p.amount AS TEXT) AS "amountScaled",CAST(${paidExpression} AS TEXT) AS "paidScaled",CAST(${payableBalance} AS TEXT) AS "outstandingScaled",p.due_date AS "dueDate",p.created_at AS "createdAt"`;
    const results = await db.batch([
      db.prepare(`SELECT ${columns} FROM payables p${q.where} ORDER BY ${q.sort} LIMIT ? OFFSET ?`).bind(...q.values, p.pageSize + 1, (p.page - 1) * p.pageSize),
      db.prepare(`SELECT COUNT(*) AS total,COALESCE(SUM(p.amount),0) AS principal,COALESCE(SUM(${payableBalance}),0) AS outstanding FROM payables p${q.where}`).bind(...q.values),
      db.prepare('SELECT COUNT(*) AS source_total FROM payables WHERE actor_id=?').bind(context.actorId),
    ]);
    const items = results[0].results.slice(0, p.pageSize);
    const summary = results[1].results[0] ?? {};
    return respond({ items, pageInfo: { total: Number(summary.total ?? 0), sourceTotal: Number((results[2].results[0] as { source_total?: number })?.source_total ?? 0), hasMore: results[0].results.length > p.pageSize }, aggregates: [{ metricId: 'payables.principal', label: 'Valor registrado', value: String(summary.principal ?? 0), scale: 4, authority: 'payables.persistedLedger.v1', drilldown: { filters: { q: '' } } }, { metricId: 'payables.outstanding', label: 'Saldo em aberto', value: String(summary.outstanding ?? 0), scale: 4, authority: 'payables.persistedLedger.v1', drilldown: { filters: { state: 'outstanding' } } }], generatedAt: new Date().toISOString() }, context);
  } catch (error) { return failure(error, context); }
}

export async function POST(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request, true);
    const parsed = createCommand.safeParse(await jsonBody(request));
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Verifique fornecedor, origem, valor e vencimento.');
    const data = parsed.data;
    const hash = await fingerprint({ actor: context.actorId, data });
    const db = database();
    const prior = await db.prepare('SELECT actor_id,request_hash FROM payables WHERE id=?').bind(data.id).first<{ actor_id: string; request_hash: string }>();
    if (prior) { if (prior.actor_id !== context.actorId || prior.request_hash !== hash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Identificador de obrigação já utilizado.'); return respond({ id: data.id, replayed: true }, context); }
    await db.prepare('INSERT INTO payables(id,supplier,source_reference,description,amount,due_date,created_at,actor_id,request_hash,correlation_id) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(data.id, data.supplier, data.sourceReference, data.description, data.amount, data.dueDate, new Date().toISOString(), context.actorId, hash, context.correlationId).run();
    return respond({ id: data.id }, context, 201);
  } catch (error) { return failure(error, context); }
}
