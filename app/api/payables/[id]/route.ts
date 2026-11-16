import { z } from 'zod';
import { database } from '../../../../db/raw';
import { ApiError, failure, requestContext, respond, type RequestContext } from '../../../../lib/api/http';
import { financialHistory, historyPageInfo, parseHistoryPage } from '../../../../lib/projections/financial-history';
import { paidExpression, payableBalance } from '../../../../lib/projections/payables';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const id = (await params).id;
    if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, 'VALIDATION_FAILED', 'Obrigação inválida.');
    const page = parseHistoryPage(request);
    const db = database();
    const results = await db.batch([
      db.prepare(`SELECT p.id,p.supplier,p.source_reference AS "sourceReference",p.description,p.due_date AS "dueDate",CAST(p.amount AS TEXT) AS "principal",CAST(${paidExpression} AS TEXT) AS "paid",CAST(${payableBalance} AS TEXT) AS "outstanding" FROM payables p WHERE p.id=? AND p.actor_id=?`).bind(id, context.actorId),
      db.prepare('SELECT COUNT(*) AS total FROM payable_payments WHERE payable_id=?').bind(id),
      ...financialHistory('payables', id, page),
    ]);
    if (!results[0].results.length) throw new ApiError(404, 'NOT_FOUND', 'Obrigação indisponível.');
    const row = results[0].results[0] as Record<string, unknown>;
    const history = results[2].results as Array<Record<string, unknown>>;
    const total = Number((results[3].results[0] as { total?: number })?.total ?? 0);
    const outstanding = Number(row.outstanding);
    const state = outstanding === 0 ? { code: 'settled', label: 'Paga', rowVersion: 1 } : Number(row.paid) === 0 ? { code: 'open', label: 'Em aberto', rowVersion: 1 } : { code: 'partial', label: 'Parcial', rowVersion: 1 };
    return respond({ projection: { identity: { id, title: String(row.supplier), subtitle: String(row.sourceReference) }, state, facts: { principalScaled: String(row.principal), paidScaled: String(row.paid), outstandingScaled: String(row.outstanding), dueDate: String(row.dueDate) }, source: { reference: String(row.sourceReference), description: String(row.description) }, payments: history.map(entry => ({ canReverse: Number(entry.canReverse), id: entry.id, kind: entry.kind, amountScaled: entry.amountScaled, effectiveDate: entry.effectiveDate, reference: entry.reference, reversed: entry.reversed })), paymentsPageInfo: historyPageInfo(page, total), availableCommands: outstanding > 0 ? [{ id: 'record_payment' }] : [], warnings: ['Pagamentos persistidos no ledger financeiro; conciliação bancária será conectada em etapa posterior.'] } }, context);
  } catch (error) { return failure(error, context); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const id = (await params).id;
    if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, 'VALIDATION_FAILED', 'Obrigação inválida.');
    const result = await database().transaction(async query => {
      const found = await query('SELECT id,supplier,source_reference FROM payables WHERE id=$1 AND actor_id=$2 FOR UPDATE', [id, context!.actorId]);
      if (!found.rows.length) throw new ApiError(404, 'NOT_FOUND', 'Obrigação indisponível.');
      const row = found.rows[0];
      if (!String(row.source_reference).startsWith('UAT-') && !String(row.supplier).includes('UAT FICTÍCIO')) throw new ApiError(403, 'SYNTHETIC_ONLY', 'Somente dados fictícios identificados por UAT podem ser excluídos.');
      const payments = await query('SELECT 1 FROM payable_payments WHERE payable_id=$1 LIMIT 1', [id]);
      if (payments.rows.length) throw new ApiError(409, 'LEDGER_NOT_EMPTY', 'Estorne os lançamentos antes de excluir o dado fictício.');
      await query('INSERT INTO finance_audit_events (id,entity_type,entity_id,action,actor_id,request_hash,correlation_id,metadata,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [crypto.randomUUID(), 'payable', id, 'synthetic_deleted', context!.actorId, `delete:${id}`, context!.correlationId, JSON.stringify({ sourceReference: row.source_reference }), new Date().toISOString()]);
      await query('DELETE FROM payables WHERE id=$1 AND actor_id=$2', [id, context!.actorId]);
      return { id };
    });
    return respond({ deleted: true, id: result.id }, context);
  } catch (error) { return failure(error, context); }
}
