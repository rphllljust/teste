import { z } from 'zod';
import { database } from '../../../../../db/raw';
import { ApiError, failure, requestContext, respond, type RequestContext } from '../../../../../lib/api/http';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const statementId = (await params).id;
    if (!z.string().uuid().safeParse(statementId).success) throw new ApiError(400, 'VALIDATION_FAILED', 'Extrato inválido.');
    const url = new URL(request.url);
    const state = url.searchParams.get('state') ?? 'unmatched';
    const lineId = url.searchParams.get('lineId') ?? '';
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));
    const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get('pageSize') ?? '25')));
    const db = database();
    const statement = await db.prepare('SELECT id,account_reference AS "accountReference",source_reference AS "sourceReference",period_start AS "periodStart",period_end AS "periodEnd",CAST(opening_balance AS TEXT) AS "openingBalanceScaled",CAST(closing_balance AS TEXT) AS "closingBalanceScaled",expected_count AS "lineCount" FROM bank_statements WHERE id=? AND actor_id=?').bind(statementId, context.actorId).first();
    if (!statement) throw new ApiError(404, 'NOT_FOUND', 'Extrato indisponível.');
    const matchExists = `EXISTS (SELECT 1 FROM bank_reconciliation_events m WHERE m.line_id=l.id AND m.kind='match' AND NOT EXISTS (SELECT 1 FROM bank_reconciliation_events u WHERE u.reverses_id=m.id))`;
    const stateClause = state === 'matched' ? `AND ${matchExists}` : state === 'unmatched' ? `AND NOT ${matchExists}` : '';
    const lines = await db.prepare(`SELECT l.id,l.external_key AS "externalKey",l.booked_date AS "bookedDate",l.description,CAST(l.amount AS TEXT) AS "amountScaled",(SELECT m.id FROM bank_reconciliation_events m WHERE m.line_id=l.id AND m.kind='match' AND NOT EXISTS (SELECT 1 FROM bank_reconciliation_events u WHERE u.reverses_id=m.id) ORDER BY m.created_at DESC LIMIT 1) AS "matchId",(SELECT m.receipt_id FROM bank_reconciliation_events m WHERE m.line_id=l.id AND m.kind='match' AND NOT EXISTS (SELECT 1 FROM bank_reconciliation_events u WHERE u.reverses_id=m.id) ORDER BY m.created_at DESC LIMIT 1) AS "receiptId",(SELECT m.payment_id FROM bank_reconciliation_events m WHERE m.line_id=l.id AND m.kind='match' AND NOT EXISTS (SELECT 1 FROM bank_reconciliation_events u WHERE u.reverses_id=m.id) ORDER BY m.created_at DESC LIMIT 1) AS "paymentId",1 AS "rowVersion" FROM bank_statement_lines l WHERE l.statement_id=? ${stateClause} ${lineId ? 'AND l.id=?' : ''} ORDER BY l.booked_date DESC,l.id DESC LIMIT ? OFFSET ?`).bind(...(lineId ? [statementId, lineId] : [statementId]), pageSize + 1, (page - 1) * pageSize).all();
    const summary = await db.prepare(`SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE ${matchExists})::int AS matched,COUNT(*) FILTER (WHERE NOT ${matchExists})::int AS unmatched FROM bank_statement_lines l WHERE l.statement_id=?`).bind(statementId).first<{ total: number; matched: number; unmatched: number }>();
    let candidates: Array<Record<string, unknown>> = [];
    if (lineId) {
      const line = await db.prepare('SELECT amount FROM bank_statement_lines WHERE id=? AND statement_id=?').bind(lineId, statementId).first<{ amount: number }>();
      if (line) {
        const table = Number(line.amount) >= 0 ? 'receivable_settlements' : 'payable_payments';
        const kind = Number(line.amount) >= 0 ? 'receipt' : 'payment';
        const parent = Number(line.amount) >= 0 ? 'receipt_id' : 'payment_id';
        candidates = (await db.prepare(`SELECT s.id,s.kind,CAST(s.amount AS TEXT) AS "amountScaled",${table === 'receivable_settlements' ? "'Recebível'" : "'Fornecedor'"} AS counterpart,s.reference FROM ${table} s WHERE s.actor_id=? AND s.kind=? AND s.amount=? AND NOT EXISTS (SELECT 1 FROM bank_reconciliation_events e WHERE e.${parent}=s.id AND e.kind='match' AND NOT EXISTS (SELECT 1 FROM bank_reconciliation_events u WHERE u.reverses_id=e.id)) ORDER BY s.created_at DESC LIMIT 50`).bind(context.actorId, kind, Math.abs(Number(line.amount))).all()).results as Array<Record<string, unknown>>;
      }
    }
    return respond({ statement, items: lines.results.slice(0, pageSize), pageInfo: { total: Number(summary?.total ?? 0), hasMore: lines.results.length > pageSize }, summary: { total: Number(summary?.total ?? 0), matched: Number(summary?.matched ?? 0), unmatched: Number(summary?.unmatched ?? 0) }, candidates, warnings: ['Conciliação é manual e exige valor, sinal e proprietário compatíveis.'] }, context);
  } catch (error) { return failure(error, context); }
}
