import { z } from 'zod';
import { database } from '../../../db/raw';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../lib/api/http';
import { buildStockLedger, reconcileStockLedger } from '../../lib/inventory/stockLedger';

const id = z.string().uuid();
const quantity = z.string().trim().regex(/^\d{1,10}(?:[,.]\d{1,3})?$/).transform(value => {
 const [whole, fraction = ''] = value.split(/[,.]/);
 return Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
}).refine(value => value <= 1_000_000_000_000);
const command = z.discriminatedUnion('type', [
 z.object({
  type: z.literal('create'), id,
  sku: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9._-]+$/).transform(value => value.toUpperCase()),
  name: z.string().trim().min(2).max(120), unit: z.enum(['un', 'kg', 'm', 'm²', 'm³', 'L']),
  minimum: quantity,
 }).strict(),
 z.object({
  type: z.literal('move'), id, itemId: id, direction: z.enum(['in', 'out']),
  quantity: quantity.refine(value => value > 0), reference: z.string().trim().min(3).max(160),
  orderId: id.nullable(),
 }).strict(),
]);

export async function GET(request: Request) {
 let context: RequestContext | undefined;
 try {
  context = requestContext(request);
  const url = new URL(request.url);
  const itemId = url.searchParams.get('item');
  const db = database();
  if (itemId) {
   if (!id.safeParse(itemId).success) throw new ApiError(400, 'VALIDATION_FAILED', 'Material inválido.');
   const results = await db.batch([
    db.prepare('SELECT id, sku, name, unit, minimum, COALESCE((SELECT SUM(delta) FROM inventory_movements WHERE item_id=inventory_items.id),0) AS balance FROM inventory_items WHERE owner_id=? AND id=?').bind(context.actorId, itemId),
    db.prepare('SELECT m.id, m.delta, m.reference, m.order_id AS orderId, m.procurement_order_id AS procurementOrderId, m.procurement_receipt_line_id AS receiptLineId, o.title AS orderTitle, m.created_at AS createdAt FROM inventory_movements m LEFT JOIN service_orders o ON o.id=m.order_id AND o.owner_id=m.owner_id WHERE m.owner_id=? AND m.item_id=? ORDER BY m.created_at ASC, m.id ASC LIMIT 500').bind(context.actorId, itemId),
    db.prepare("SELECT id, title FROM service_orders WHERE owner_id=? AND status='executing' ORDER BY created_at DESC, id DESC LIMIT 50").bind(context.actorId),
   ]);
   if (!results[0].results.length) throw new ApiError(404, 'NOT_FOUND', 'Material indisponível.');
   const item = results[0].results[0] as { balance: number };
   const ledger = buildStockLedger(results[1].results as never[]);
   return respond({ item, movements: results[1].results, orders: results[2].results, ledger: { entries: ledger.entries, closingBalance: ledger.closingBalance, reconciliation: reconcileStockLedger(ledger, Number(item.balance)) } }, context);
  }
  const query = (url.searchParams.get('q') ?? '').trim().slice(0, 120);
  const page = Number(url.searchParams.get('page') ?? '1');
  if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000) throw new ApiError(400, 'VALIDATION_FAILED', 'Página inválida.');
  const results = await db.batch([
   db.prepare("SELECT id, sku, name, unit, minimum, COALESCE((SELECT SUM(delta) FROM inventory_movements WHERE item_id=inventory_items.id),0) AS balance FROM inventory_items WHERE owner_id=? AND (LOWER(sku) LIKE '%' || LOWER(?) || '%' OR LOWER(name) LIKE '%' || LOWER(?) || '%') ORDER BY sku LIMIT 26 OFFSET ?").bind(context.actorId, query, query, (page - 1) * 25),
   db.prepare('SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE COALESCE((SELECT SUM(delta) FROM inventory_movements WHERE item_id=inventory_items.id),0) <= minimum) AS low FROM inventory_items WHERE owner_id=?').bind(context.actorId),
  ]);
  return respond({ items: results[0].results.slice(0, 25), hasMore: results[0].results.length > 25, summary: results[1].results[0] }, context);
 } catch (error) { return failure(error, context); }
}

export async function POST(request: Request) {
 let context: RequestContext | undefined;
 try {
  context = requestContext(request, true);
  const parsed = command.safeParse(await jsonBody(request));
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Verifique o material, a quantidade e a referência.');
  const data = parsed.data;
  if (data.type === 'move' && data.direction === 'in' && data.orderId) throw new ApiError(400, 'VALIDATION_FAILED', 'A OS só pode ser vinculada a uma saída.');
  const db = database();
  const hash = await fingerprint({ actor: context.actorId, data });
  const now = new Date().toISOString();
  const table = data.type === 'create' ? 'inventory_items' : 'inventory_movements';
  const find = () => db.prepare(`SELECT owner_id, request_hash FROM ${table} WHERE id=?`).bind(data.id).first<{ owner_id: string; request_hash: string }>();
  async function replay() {
   const prior = await find();
   if (!prior) return false;
   if (prior.owner_id !== context?.actorId || prior.request_hash !== hash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Identificador de operação já utilizado.');
   return true;
  }
  if (await replay()) return respond({ id: data.id, replayed: true }, context);
  try {
   if (data.type === 'create') {
    await db.prepare('INSERT INTO inventory_items (id,owner_id,sku,name,unit,minimum,created_at,request_hash) VALUES (?,?,?,?,?,?,?,?)')
     .bind(data.id, context.actorId, data.sku, data.name, data.unit, data.minimum, now, hash).run();
   } else {
    await db.prepare('INSERT INTO inventory_movements (id,item_id,owner_id,order_id,delta,reference,created_at,request_hash,correlation_id) VALUES (?,?,?,?,?,?,?,?,?)')
     .bind(data.id, data.itemId, context.actorId, data.orderId, data.direction === 'in' ? data.quantity : -data.quantity, data.reference, now, hash, context.correlationId).run();
   }
  } catch (error) {
   if (await replay()) return respond({ id: data.id, replayed: true }, context);
   const message = error instanceof Error ? error.message : '';
   if (message.includes('inventory_items.owner_id, inventory_items.sku')) throw new ApiError(409, 'SKU_EXISTS', 'Já existe um material com esse código.');
   if (message.includes('CISNE_INVENTORY_BALANCE')) throw new ApiError(409, 'BALANCE_CONFLICT', 'A movimentação supera o saldo disponível ou o limite de estoque.');
   if (message.includes('CISNE_INVENTORY_ORDER')) throw new ApiError(409, 'ORDER_CONFLICT', 'Selecione uma OS sua em execução.');
   if (message.includes('CISNE_INVENTORY_OWNER')) throw new ApiError(404, 'NOT_FOUND', 'Material indisponível.');
   throw error;
  }
  return respond({ id: data.id }, context, 201);
 } catch (error) { return failure(error, context); }
}
