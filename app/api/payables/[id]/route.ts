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
      db.prepare('SELECT i.order_id AS "orderId",po.reference AS "orderReference",'+
        'i.document_number AS "documentNumber",i.issue_date AS "issueDate" '+
        'FROM procurement_supplier_invoices i JOIN supplier_purchase_orders po '+
        'ON po.id=i.order_id AND po.owner_id=i.owner_id '+
        'WHERE i.payable_id=? AND i.owner_id=?').bind(id,context.actorId),
    ]);
    if (!results[0].results.length) throw new ApiError(404, 'NOT_FOUND', 'Obrigação indisponível.');
    const row = results[0].results[0] as Record<string, unknown>;
    const history = results[2].results as Array<Record<string, unknown>>;
    const total = Number((results[3].results[0] as { total?: number })?.total ?? 0);
    const outstanding = Number(row.outstanding);
    const state = outstanding === 0 ? { code: 'settled', label: 'Paga', rowVersion: 1 } : Number(row.paid) === 0 ? { code: 'open', label: 'Em aberto', rowVersion: 1 } : { code: 'partial', label: 'Parcial', rowVersion: 1 };
    return respond({ projection: { identity: { id, title: String(row.supplier), subtitle: String(row.sourceReference) }, state, facts: { principalScaled: String(row.principal), paidScaled: String(row.paid), outstandingScaled: String(row.outstanding), dueDate: String(row.dueDate) }, source: { reference: String(row.sourceReference), description: String(row.description), procurement: results[4].results[0] ?? null }, payments: history.map(entry => ({ canReverse: Number(entry.canReverse), id: entry.id, kind: entry.kind, amountScaled: entry.amountScaled, effectiveDate: entry.effectiveDate, reference: entry.reference, reversed: entry.reversed })), paymentsPageInfo: historyPageInfo(page, total), availableCommands: outstanding > 0 ? [{ id: 'record_payment' }] : [], warnings: ['A obrigação é rastreável pela origem documental; a conciliação bancária utiliza os eventos de pagamento e os extratos persistidos.'] } }, context);
  } catch (error) { return failure(error, context); }
}
