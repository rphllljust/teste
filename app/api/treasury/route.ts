import { database } from '../../../db/raw';
import { failure, requestContext, respond, type RequestContext } from '../../../lib/api/http';

export async function GET(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, 160);
    const pendingOnly = url.searchParams.get('pendingOnly') === '1';
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));
    const db = database();
    const where = `WHERE s.actor_id=? AND (?='' OR s.account_reference ILIKE '%'||?||'%')`;
    const pending = `(SELECT COUNT(*) FROM bank_statement_lines l JOIN bank_statements linked ON linked.id=l.statement_id WHERE linked.actor_id=s.actor_id AND linked.account_reference=s.account_reference AND NOT EXISTS (SELECT 1 FROM bank_reconciliation_events m WHERE m.line_id=l.id AND m.kind='match' AND NOT EXISTS (SELECT 1 FROM bank_reconciliation_events u WHERE u.reverses_id=m.id)))`;
    const filter = pendingOnly ? ` AND ${pending}>0` : '';
    const results = await db.batch([
      db.prepare(`SELECT s.account_reference AS "accountReference",s.id AS "statementId",s.source_reference AS "sourceReference",s.period_end AS "asOf",CAST(s.closing_balance AS TEXT) AS "closingBalanceScaled",(SELECT COUNT(*) FROM bank_statements x WHERE x.actor_id=s.actor_id AND x.account_reference=s.account_reference) AS "statementCount",${pending} AS "unmatchedCount" FROM bank_statements s ${where}${filter} AND NOT EXISTS (SELECT 1 FROM bank_statements newer WHERE newer.actor_id=s.actor_id AND newer.account_reference=s.account_reference AND (newer.period_end>s.period_end OR (newer.period_end=s.period_end AND newer.id>s.id))) ORDER BY s.period_end DESC,s.id DESC LIMIT ? OFFSET ?`).bind(context.actorId, q, q, 26, (page - 1) * 25),
      db.prepare(`SELECT COUNT(*) AS total FROM bank_statements s ${where}${filter} AND NOT EXISTS (SELECT 1 FROM bank_statements newer WHERE newer.actor_id=s.actor_id AND newer.account_reference=s.account_reference AND (newer.period_end>s.period_end OR (newer.period_end=s.period_end AND newer.id>s.id)))`).bind(context.actorId, q, q),
      db.prepare('SELECT COUNT(DISTINCT account_reference) AS source_total FROM bank_statements WHERE actor_id=?').bind(context.actorId),
    ]);
    const total = Number((results[1].results[0] as { total?: number })?.total ?? 0);
    const sourceTotal = Number((results[2].results[0] as { source_total?: number })?.source_total ?? 0);
    return respond({ items: results[0].results.slice(0, 25), pageInfo: { total, sourceTotal, hasMore: results[0].results.length > 25 }, emptyState: sourceTotal ? (total ? null : 'page-empty') : 'source-empty', generatedAt: new Date().toISOString(), warnings: ['Saldo de fechamento corresponde ao extrato mais recente da conta. A contagem de pendências agrega todos os extratos dessa referência bancária; saldo disponível em tempo real não está conectado.'] }, context);
  } catch (error) { return failure(error, context); }
}
