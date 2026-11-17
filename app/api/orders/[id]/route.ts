import { z } from 'zod';
import { databasePool } from '../../../../db/raw';
import { ApiError, failure, requestContext, respond, type RequestContext } from '../../../../lib/api/http';
import { projectOrder, type OrderRow } from '../../../../lib/projections/orders';
import { outstandingExpression } from '../../../../lib/projections/operation';

export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ id: string }> };
const uuid = z.string().uuid();

/**
 * Context drawer for an owned service order. This route intentionally refuses
 * ownerless legacy rows: a historical NULL owner must not grant cross-user
 * document or operational detail access.
 */
export async function GET(request: Request, {params}: RouteContext): Promise<Response> {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const {id} = await params;
    if (!uuid.safeParse(id).success)
      throw new ApiError(400, 'VALIDATION_FAILED', 'Ordem de serviço inválida.');

    const db = databasePool();
    const orderResult = await db.query<OrderRow>(
      'SELECT * FROM service_orders WHERE id=$1 AND owner_id=$2 LIMIT 1',
      [id, context.actorId],
    );
    const row = orderResult.rows[0];
    if (!row)
      throw new ApiError(404, 'NOT_FOUND', 'Ordem de serviço não encontrada.');

    // Every subquery is bound to the already verified order ID. No client,
    // actor, tenant, document URL or state from HTTP input is trusted.
    // The schedule migration is additive; during a rolling deploy, an older
    // database must continue serving the OS context without schedule rows.
    const schedulePromise = db.query<{id:string;start_at:string;end_at:string;timezone:string;status:string;notes:string|null}>(
      'SELECT id,start_at,end_at,timezone,status,notes,assignee_type,assignee_id FROM service_schedules WHERE order_id=$1 AND owner_id=$2 ORDER BY start_utc ASC,id ASC LIMIT 20',
      [id, context.actorId],
    ).catch(error => {
      if ((error as {code?:string})?.code === '42P01') return {rows:[]};
      throw error;
    });
    const [relations, events, historyCount, finance, schedules] = await Promise.all([
      db.query<{
        measurements:number; invoices:number; receivables:number;
      }>(`SELECT
          (SELECT count(*)::int FROM measurements WHERE order_id=$1) AS measurements,
          (SELECT count(*)::int FROM invoices WHERE order_id=$1) AS invoices,
          (SELECT count(*)::int FROM receivables r
             JOIN invoices i ON i.id=r.invoice_id
             WHERE i.order_id=$1) AS receivables`, [id]),
      db.query<{id:string;order_id:string;command:string;created_at:string}>(
        'SELECT id,order_id,command,created_at FROM order_events WHERE order_id=$1 ORDER BY created_at DESC,id DESC LIMIT 20',
        [id],
      ),
      db.query<{n:number}>('SELECT count(*)::int AS n FROM order_events WHERE order_id=$1', [id]),
      // Totals are scoped to the already authenticated OS, not a client,
      // account, owner or tenant supplied by the browser. Receivable sums
      // use the SAME persisted settlement ledger as the Financeiro module.
      db.query<{
        measured_scaled:string; invoiced_scaled:string;
        receivable_scaled:string; settled_scaled:string; outstanding_scaled:string;
      }>(`SELECT
          (SELECT CAST(COALESCE(SUM(m.amount),0) AS TEXT)
             FROM measurements m WHERE m.order_id=$1) AS measured_scaled,
          (SELECT CAST(COALESCE(SUM(i.amount),0) AS TEXT)
             FROM invoices i WHERE i.order_id=$1) AS invoiced_scaled,
          (SELECT CAST(COALESCE(SUM(r.amount),0) AS TEXT)
             FROM receivables r JOIN invoices i ON i.id=r.invoice_id
             WHERE i.order_id=$1) AS receivable_scaled,
          (SELECT CAST(COALESCE(SUM(r.amount-(${outstandingExpression})),0) AS TEXT)
             FROM receivables r JOIN invoices i ON i.id=r.invoice_id
             WHERE i.order_id=$1) AS settled_scaled,
          (SELECT CAST(COALESCE(SUM(${outstandingExpression}),0) AS TEXT)
             FROM receivables r JOIN invoices i ON i.id=r.invoice_id
             WHERE i.order_id=$1) AS outstanding_scaled`, [id]),
      schedulePromise,
    ]);
    const metric = relations.rows[0];
    const financial = finance.rows[0];
    const scheduleRows = schedules.rows;
    const total = historyCount.rows[0]?.n ?? 0;
    const labels:Record<string,string> = {
      create:'OS cadastrada', authorize:'OS autorizada', start:'Execução iniciada',
      complete:'OS concluída', cancel:'OS cancelada',
    };
    const history = events.rows.map(item => ({
      ...item, label:labels[item.command] ?? 'Evento: '+item.command,
    }));

    return respond({
      order:{
        ...projectOrder(row),
        relations:{
          clientId:row.client_id ?? null,
          contractId:row.contract_id ?? null,
          measurements:metric?.measurements ?? 0,
          invoices:metric?.invoices ?? 0,
          receivables:metric?.receivables ?? 0,
        },
        // This is Field's own financial ledger for this service order, NOT
        // a NextCRM invoice or a reconciled bank balance. Scaled decimal
        // strings preserve monetary precision at the API boundary.
        schedules:scheduleRows,
        finance:{
          measuredScaled:financial?.measured_scaled ?? '0',
          invoicedScaled:financial?.invoiced_scaled ?? '0',
          receivableScaled:financial?.receivable_scaled ?? '0',
          settledScaled:financial?.settled_scaled ?? '0',
          outstandingScaled:financial?.outstanding_scaled ?? '0',
          moneyScale:4,
          currency:'BRL',
          authority:'field.persistedReceivableSettlementLedger.v1',
          generatedAt:new Date().toISOString(),
          bankBalanceAvailable:false,
        },
        sublists:{history:{
          items:history,
          pageInfo:{total,hasMore:total>history.length},
        }},
      },
    }, context);
  } catch(error) {
    return failure(error,context);
  }
}
