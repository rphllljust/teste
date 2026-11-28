import { database } from '../../../../db/raw';
import { failure, requestContext, respond, type RequestContext } from '../../../../lib/api/http';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const db = database();
    const batch = await db.batch([
      db.prepare("SELECT id,legal_name FROM clients WHERE owner_id=? AND status='active' ORDER BY legal_name ASC LIMIT 100").bind(context.actorId),
      db.prepare('SELECT id,title,contract_id AS "contractId" FROM service_orders WHERE owner_id=? AND status NOT IN (\'cancelled\') ORDER BY created_at DESC,id DESC LIMIT 100').bind(context.actorId),
      db.prepare("SELECT id,reference FROM contracts WHERE owner_id=? AND status NOT IN ('cancelled','closed') ORDER BY created_at DESC,id DESC LIMIT 100").bind(context.actorId),
      db.prepare('SELECT i.id,i.amount,i.due_date AS "dueDate",i.order_id AS "orderId" FROM invoices i JOIN service_orders o ON o.id=i.order_id WHERE o.owner_id=? ORDER BY i.created_at DESC,i.id DESC LIMIT 100').bind(context.actorId),
      db.prepare('SELECT r.id,r.amount,r.due_date AS "dueDate",r.invoice_id AS "invoiceId" FROM receivables r JOIN invoices i ON i.id=r.invoice_id JOIN service_orders o ON o.id=i.order_id WHERE o.owner_id=? ORDER BY r.created_at DESC,r.id DESC LIMIT 100').bind(context.actorId),
      db.prepare("SELECT id,source_reference,amount,due_date FROM payables WHERE actor_id=? ORDER BY created_at DESC,id DESC LIMIT 100").bind(context.actorId),
    ]);
    const clients = batch[0] as { results: Array<Record<string, unknown>> };
    const orders = batch[1] as { results: Array<Record<string, unknown>> };
    const contracts = batch[2] as { results: Array<Record<string, unknown>> };
    const invoices = batch[3] as { results: Array<Record<string, unknown>> };
    const receivables = batch[4] as { results: Array<Record<string, unknown>> };
    const payables = batch[5] as { results: Array<Record<string, unknown>> };
    return respond({
      clients: clients.results,
      orders: orders.results,
      contracts: contracts.results,
      invoices: invoices.results,
      receivables: receivables.results,
      payables: payables.results,
    }, context);
  } catch (error) { return failure(error, context); }
}
