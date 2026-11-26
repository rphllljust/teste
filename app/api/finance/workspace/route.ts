import { z } from 'zod';
import { database } from '../../../../db/raw';
import { failure, requestContext, respond, type RequestContext } from '../../../../lib/api/http';
import { outstandingExpression } from '../../../../lib/projections/operation';
import { payableBalance } from '../../../../lib/projections/payables';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

type AggregateRow = { count?: number | string; value?: string | null };

export async function GET(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const url = new URL(request.url);
    const asOf = url.searchParams.get('asOf') ?? new Date().toISOString().slice(0, 10);
    if (!date.safeParse(asOf).success) {
      return Response.json(
        { error: 'Data de referência financeira inválida.', code: 'VALIDATION_FAILED', correlationId: context.correlationId },
        { status: 400, headers: { 'Cache-Control': 'no-store', 'X-Correlation-Id': context.correlationId } },
      );
    }

    const db = database();
    const results = await db.batch([
      db.prepare(`SELECT COUNT(*) AS count,CAST(COALESCE(SUM(${outstandingExpression}),0) AS TEXT) AS value
        FROM receivables r
        JOIN invoices i ON i.id=r.invoice_id
        JOIN service_orders o ON o.id=i.order_id
        WHERE o.owner_id=? AND ${outstandingExpression}>0`).bind(context.actorId),
      db.prepare(`SELECT COUNT(*) AS count,CAST(COALESCE(SUM(${outstandingExpression}),0) AS TEXT) AS value
        FROM receivables r
        JOIN invoices i ON i.id=r.invoice_id
        JOIN service_orders o ON o.id=i.order_id
        WHERE o.owner_id=? AND ${outstandingExpression}>0 AND r.due_date<?`).bind(context.actorId, asOf),
      db.prepare(`SELECT COUNT(*) AS count,CAST(COALESCE(SUM(${payableBalance}),0) AS TEXT) AS value
        FROM payables p
        WHERE p.actor_id=? AND ${payableBalance}>0`).bind(context.actorId),
      db.prepare(`SELECT COUNT(*) AS count,CAST(COALESCE(SUM(${payableBalance}),0) AS TEXT) AS value
        FROM payables p
        WHERE p.actor_id=? AND ${payableBalance}>0 AND p.due_date<?`).bind(context.actorId, asOf),
    ]);

    const row = (index: number) => (results[index].results[0] ?? {}) as AggregateRow;
    const metric = (
      metricId: string,
      label: string,
      aggregate: AggregateRow,
      authority: string,
      viewKey: string,
      filters: Record<string, string>,
    ) => ({
      metricId,
      label,
      value: aggregate.value ?? '0',
      count: Number(aggregate.count ?? 0),
      status: 'available',
      authority,
      drilldown: { viewKey, filters },
    });

    const generatedAt = new Date().toISOString();
    return respond({
      asOf,
      generatedAt,
      metrics: [
        metric('receivables.outstanding', 'Contas a receber', row(0), 'receivables.persistedSettlementLedger.v1', 'operation.receivables', { settlementState: 'outstanding', sort: 'dueDate.asc' }),
        metric('receivables.overdue', 'Recebíveis vencidos', row(1), 'receivables.persistedSettlementLedger.v1', 'operation.receivables', { settlementState: 'outstanding', dueTo: asOf, sort: 'dueDate.asc' }),
        metric('payables.outstanding', 'Contas a pagar', row(2), 'payables.persistedLedger.v1', 'payables.worklist', { state: 'outstanding', sort: 'dueDate.asc' }),
        metric('payables.overdue', 'Pagamentos vencidos', row(3), 'payables.persistedLedger.v1', 'payables.worklist', { state: 'outstanding', dueTo: asOf, sort: 'dueDate.asc' }),
      ],
      availableCash: {
        value: null,
        reason: 'Depende de extrato bancário importado e conciliado; títulos em aberto não representam saldo disponível.',
      },
      warnings: [
        'Valores vencidos usam vencimento anterior à data de referência.',
        'Saldos consideram recebimentos, pagamentos e estornos persistidos.',
      ],
    }, context);
  } catch (error) {
    return failure(error, context);
  }
}
