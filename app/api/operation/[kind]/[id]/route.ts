import { z } from 'zod';
import { ApiError, failure, requestContext, respond, type RequestContext } from '../../../../../lib/api/http';
import { database } from '../../../../../db/raw';
import { financialHistory, historyPageInfo, parseHistoryPage } from '../../../../../lib/projections/financial-history';
import { outstandingExpression } from '../../../../../lib/projections/operation';

const kindSchema = z.enum(['measurements', 'invoices', 'receivables']);

export async function GET(request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const { kind: rawKind, id } = await params;
    const kind = kindSchema.safeParse(rawKind);
    if (!kind.success || !z.string().uuid().safeParse(id).success) throw new ApiError(400, 'VALIDATION_FAILED', 'Registro financeiro inválido.');
    const historyPage = parseHistoryPage(request);
    const db = database();
    const joins = kind.data === 'measurements'
      ? 'measurements m JOIN service_orders o ON o.id=m.order_id'
      : kind.data === 'invoices'
        ? 'invoices i JOIN measurements m ON m.id=i.measurement_id JOIN service_orders o ON o.id=i.order_id'
        : 'receivables r JOIN invoices i ON i.id=r.invoice_id JOIN measurements m ON m.id=i.measurement_id JOIN service_orders o ON o.id=i.order_id';
    const alias = kind.data === 'measurements' ? 'm' : kind.data === 'invoices' ? 'i' : 'r';
    const rows = await db.batch([
      db.prepare(`SELECT ${alias}.id,${alias}.created_at,CAST(${alias}.amount AS TEXT) principal_scaled,${kind.data === 'measurements' ? 'o.due_date' : `${alias}.due_date`} due_date,o.id order_id,o.title order_title,o.client,o.owner_id,${kind.data === 'measurements' ? 'm.description,m.status,m.version' : kind.data === 'invoices' ? 'm.description,\'registered\' AS status,m.version,i.measurement_id' : `m.description,CASE WHEN ${outstandingExpression}=0 THEN 'settled' WHEN ${outstandingExpression}=r.amount THEN 'open' ELSE 'partial' END status,1 version,i.invoice_id,i.measurement_id,CAST(COALESCE((SELECT SUM(CASE WHEN s.kind='receipt' THEN s.amount ELSE -s.amount END) FROM receivable_settlements s WHERE s.receivable_id=r.id),0) AS TEXT) settled_scaled`} FROM ${joins} WHERE ${alias}.id=? AND (o.owner_id IS NULL OR o.owner_id=?)`).bind(id, context.actorId),
      ...(kind.data === 'receivables' ? financialHistory('receivables', id, historyPage) : []),
    ]);
    const row = rows[0].results[0] as Record<string, unknown> | undefined;
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Registro financeiro não encontrado.');
    const principal = String(row.principal_scaled ?? '0');
    const settled = kind.data === 'receivables' ? String(row.settled_scaled ?? '0') : '0';
    const history = kind.data === 'receivables' ? rows.slice(1) : [];
    const historyRows = (history[0]?.results ?? []) as Array<Record<string, unknown>>;
    const historyTotal = Number((history[1]?.results[0] as { total?: number } | undefined)?.total ?? 0);
    const projection = {
      identity: { id, title: String(row.order_title ?? id), subtitle: String(row.client ?? 'Cliente não informado'), entityKey: kind.data === 'measurements' ? 'measurements' : kind.data === 'invoices' ? 'invoices' : 'receivables' },
      state: { code: String(row.status ?? 'registered'), label: String(row.status ?? 'Registrado'), rowVersion: Number(row.version ?? 1) },
      facts: { principalScaled: principal, dueDate: row.due_date ? String(row.due_date) : null, createdAt: String(row.created_at ?? ''), outstandingScaled: kind.data === 'receivables' ? String(BigInt(principal) - BigInt(settled)) : null, settledScaled: kind.data === 'receivables' ? settled : null },
      relations: { orderId: String(row.order_id), orderTitle: String(row.order_title ?? ''), measurementId: kind.data === 'measurements' ? id : String(row.measurement_id ?? ''), measurementDescription: String(row.description ?? ''), invoiceId: kind.data === 'receivables' ? String(row.invoice_id ?? '') : kind.data === 'invoices' ? id : null, receivableId: kind.data === 'receivables' ? id : null },
      settlements: kind.data === 'receivables' ? historyRows : [],
      settlementsPageInfo: kind.data === 'receivables' ? historyPageInfo(historyPage, historyTotal) : undefined,
      evidence: [],
      evidencePageInfo: { total: 0 },
      availableCommands: kind.data === 'receivables' && BigInt(principal) > BigInt(settled) ? [{ id: 'record_receipt', label: 'Registrar recebimento', primary: true }] : [],
      warnings: kind.data === 'receivables' ? ['Recebimentos informados manualmente; conciliação bancária não conectada.'] : [],
    };
    return respond({ projection }, context);
  } catch (error) {
    return failure(error, context);
  }
}
