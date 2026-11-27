import { z } from 'zod';
import { database } from '../../../../db/raw';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../lib/api/http';
import { assertFinancePeriodOpen } from '../../../../lib/application/finance';

const postgresIntegerMin = -2147483648n, postgresIntegerMax = 2147483647n;
const money = z.string().trim().regex(/^-?\d{1,12}(?:[,.]\d{1,4})?$/).transform(value => { const negative = value.startsWith('-'); const [whole, fraction = ''] = (negative ? value.slice(1) : value).split(/[,.]/); const scaled = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0')); return negative ? -scaled : scaled; }).refine(value => value >= postgresIntegerMin && value <= postgresIntegerMax, 'Valor excede a capacidade do livro bancário.').transform(Number);
const command = z.object({ id: z.string().uuid(), accountReference: z.string().trim().min(3).max(160), sourceReference: z.string().trim().min(3).max(160), periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), openingBalance: money, closingBalance: money, lines: z.array(z.object({ id: z.string().uuid(), externalKey: z.string().trim().min(1).max(160), bookedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), amount: money, description: z.string().trim().min(1).max(500) }).strict()).min(1).max(100) }).strict();

export async function GET(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));
    const account = (url.searchParams.get('accountReference') ?? '').trim();
    const db = database();
    const result = await db.prepare('SELECT id,account_reference AS "accountReference",source_reference AS "sourceReference",period_start AS "periodStart",period_end AS "periodEnd",CAST(opening_balance AS TEXT) AS "openingBalanceScaled",CAST(closing_balance AS TEXT) AS "closingBalanceScaled",expected_count AS "lineCount",(SELECT COUNT(*)::int FROM bank_statement_lines l WHERE l.statement_id=bank_statements.id AND NOT EXISTS (SELECT 1 FROM bank_reconciliation_events m WHERE m.line_id=l.id AND m.kind=\'match\' AND NOT EXISTS (SELECT 1 FROM bank_reconciliation_events u WHERE u.reverses_id=m.id))) AS "unmatchedCount" FROM bank_statements WHERE actor_id=? AND (?=\'\' OR account_reference=?) ORDER BY period_end DESC,id DESC LIMIT 26 OFFSET ?').bind(context.actorId, account, account, (page - 1) * 25).all();
    return respond({ items: result.results.slice(0, 25), pageInfo: { hasMore: result.results.length > 25 } }, context);
  } catch (error) { return failure(error, context); }
}

export async function saveBankStatement(context: RequestContext, body: unknown) {
    const parsed = command.safeParse(body);
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Extrato ou linhas inválidas.');
    const data = parsed.data;
    if (data.periodEnd < data.periodStart) throw new ApiError(400, 'VALIDATION_FAILED', 'O período do extrato é inválido.');
    const movementTotal = data.lines.reduce((sum, line) => sum + BigInt(line.amount), 0n);
    if (BigInt(data.openingBalance) + movementTotal !== BigInt(data.closingBalance)) throw new ApiError(409, 'STATEMENT_BALANCE_CONFLICT', 'As linhas não fecham o saldo final informado.');
    const hash = await fingerprint({ actor: context.actorId, data });
    const db = database();
    const existing = await db.prepare('SELECT actor_id,request_hash FROM bank_statements WHERE id=?').bind(data.id).first<{ actor_id: string; request_hash: string }>();
    if (existing) { if (existing.actor_id !== context.actorId || existing.request_hash !== hash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Identificador de extrato já utilizado.'); return respond({ id: data.id, replayed: true }, context); }
    await db.transaction(async query => {
      for (const line of data.lines) await assertFinancePeriodOpen(query, context.actorId, line.bookedDate);
      await query('INSERT INTO bank_statements(id,account_reference,source_reference,period_start,period_end,opening_balance,closing_balance,expected_count,status,created_at,actor_id,request_hash,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', [data.id, data.accountReference, data.sourceReference, data.periodStart, data.periodEnd, data.openingBalance, data.closingBalance, data.lines.length, 'imported', new Date().toISOString(), context.actorId, hash, context.correlationId]);
      for (const line of data.lines) await query('INSERT INTO bank_statement_lines(id,statement_id,external_key,booked_date,description,amount) VALUES($1,$2,$3,$4,$5,$6)', [line.id, data.id, line.externalKey, line.bookedDate, line.description, line.amount]);
    });
    return respond({ id: data.id }, context, 201);
}

export async function POST(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request, true);
    return await saveBankStatement(context, await jsonBody(request));
  } catch (error) { return failure(error, context); }
}
