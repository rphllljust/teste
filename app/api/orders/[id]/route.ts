import { z } from 'zod';
import { databasePool } from '../../../../db/raw';
import { ApiError, failure, requestContext, respond, type RequestContext } from '../../../../lib/api/http';
import { projectOrder, type OrderRow } from '../../../../lib/projections/orders';

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
    const [relations, events, historyCount] = await Promise.all([
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
    ]);
    const metric = relations.rows[0];
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
