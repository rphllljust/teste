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
 z.object({
  type: z.literal('reserve'), id, itemId: id,
  sourceDocumentType: z.string().trim().min(2).max(60).regex(/^[A-Za-z0-9._-]+$/),
  sourceDocumentId: id,
  quantity: quantity.refine(value => value > 0),
  reference: z.string().trim().min(3).max(160),
 }).strict(),
 z.object({
  type: z.literal('consume'), id, itemId: id, orderId: id, reservationId: id,
  quantity: quantity.refine(value => value > 0),
  reference: z.string().trim().min(3).max(160),
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
    db.prepare(`SELECT id, sku, name, unit, minimum,
      COALESCE((SELECT SUM(delta) FROM inventory_movements WHERE item_id=inventory_items.id AND owner_id=inventory_items.owner_id),0) AS balance,
      COALESCE((SELECT SUM(quantity-consumed_quantity) FROM inventory_reservations WHERE item_id=inventory_items.id AND owner_id=inventory_items.owner_id AND status='reserved'),0) AS reserved,
      COALESCE((SELECT SUM(delta) FROM inventory_movements WHERE item_id=inventory_items.id AND owner_id=inventory_items.owner_id),0) -
      COALESCE((SELECT SUM(quantity-consumed_quantity) FROM inventory_reservations WHERE item_id=inventory_items.id AND owner_id=inventory_items.owner_id AND status='reserved'),0) AS available
      FROM inventory_items WHERE owner_id=? AND id=?`).bind(context.actorId, itemId),
    db.prepare('SELECT m.id, m.delta, m.reference, m.order_id AS "orderId", m.procurement_order_id AS "procurementOrderId", m.procurement_receipt_line_id AS "receiptLineId", o.title AS "orderTitle", m.created_at AS "createdAt" FROM inventory_movements m LEFT JOIN service_orders o ON o.id=m.order_id AND o.owner_id=m.owner_id WHERE m.owner_id=? AND m.item_id=? ORDER BY m.created_at ASC, m.id ASC LIMIT 500').bind(context.actorId, itemId),
    db.prepare("SELECT id, source_document_type AS \"sourceDocumentType\", source_document_id AS \"sourceDocumentId\", source_reference AS \"sourceReference\", quantity, consumed_quantity AS \"consumedQuantity\", status, created_at AS \"createdAt\" FROM inventory_reservations WHERE owner_id=? AND item_id=? ORDER BY created_at ASC, id ASC LIMIT 500").bind(context.actorId, itemId),
    db.prepare("SELECT id, title FROM service_orders WHERE owner_id=? AND status='executing' ORDER BY created_at DESC, id DESC LIMIT 50").bind(context.actorId),
   ]);
   if (!results[0].results.length) throw new ApiError(404, 'NOT_FOUND', 'Material indisponível.');
   const item = results[0].results[0] as { balance: number; reserved: number; available: number };
   const ledger = buildStockLedger(results[1].results as never[]);
   return respond({ item, movements: results[1].results, reservations: results[2].results, orders: results[3].results, ledger: { entries: ledger.entries, closingBalance: ledger.closingBalance, reconciliation: reconcileStockLedger(ledger, Number(item.balance)) } }, context);
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
  const table = data.type === 'create' ? 'inventory_items' : data.type === 'reserve' ? 'inventory_reservations' : 'inventory_movements';
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
   } else if (data.type === 'reserve') {
    await db.transaction(async query => {
     const item = await query('SELECT id FROM inventory_items WHERE id=$1 AND owner_id=$2 FOR UPDATE', [data.itemId, context!.actorId]);
     if (!item.rowCount) throw new ApiError(404, 'NOT_FOUND', 'Material indisponível.');
     const stock = await query('SELECT COALESCE(SUM(delta),0)::bigint AS balance FROM inventory_movements WHERE item_id=$1 AND owner_id=$2', [data.itemId, context!.actorId]);
    const reserved = await query("SELECT COALESCE(SUM(quantity-consumed_quantity),0)::bigint AS reserved FROM inventory_reservations WHERE item_id=$1 AND owner_id=$2 AND status='reserved'", [data.itemId, context!.actorId]);
     const available = Number(stock.rows[0]?.balance ?? 0) - Number(reserved.rows[0]?.reserved ?? 0);
     if (available < data.quantity) throw new ApiError(409, 'AVAILABILITY_CONFLICT', 'A reserva supera o saldo disponível.');
     await query(`INSERT INTO inventory_reservations
       (id,item_id,owner_id,source_document_type,source_document_id,source_reference,quantity,status,created_at,request_hash,correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'reserved',$8,$9,$10)`,
      [data.id, data.itemId, context!.actorId, data.sourceDocumentType, data.sourceDocumentId, data.reference, data.quantity, now, hash, context!.correlationId]);
    });
   } else if (data.type === 'consume') {
    await db.transaction(async query => {
     const item = await query('SELECT id FROM inventory_items WHERE id=$1 AND owner_id=$2 FOR UPDATE', [data.itemId, context!.actorId]);
     if (!item.rowCount) throw new ApiError(404, 'NOT_FOUND', 'Material indisponível.');
     const order = await query("SELECT id FROM service_orders WHERE id=$1 AND owner_id=$2 AND status='executing' FOR UPDATE", [data.orderId, context!.actorId]);
     if (!order.rowCount) throw new ApiError(409, 'ORDER_CONFLICT', 'Selecione uma OS sua em execução.');
     const reservation = await query(`SELECT source_document_id, status, quantity, consumed_quantity
       FROM inventory_reservations WHERE id=$1 AND item_id=$2 AND owner_id=$3 FOR UPDATE`, [data.reservationId, data.itemId, context!.actorId]);
     if (!reservation.rowCount) throw new ApiError(404, 'RESERVATION_NOT_FOUND', 'Reserva de material indisponível.');
     const row = reservation.rows[0] as { source_document_id: string; status: string; quantity: number; consumed_quantity: number };
     if (row.source_document_id !== data.orderId) throw new ApiError(409, 'RESERVATION_CONFLICT', 'A reserva não pertence à OS informada.');
     const remaining = Number(row.quantity) - Number(row.consumed_quantity);
     if (row.status !== 'reserved' || remaining < data.quantity) throw new ApiError(409, 'RESERVATION_CONFLICT', 'O consumo supera a quantidade reservada.');
     const stock = await query('SELECT COALESCE(SUM(delta),0)::bigint AS balance FROM inventory_movements WHERE item_id=$1 AND owner_id=$2', [data.itemId, context!.actorId]);
     if (Number(stock.rows[0]?.balance ?? 0) < data.quantity) throw new ApiError(409, 'BALANCE_CONFLICT', 'O consumo supera o saldo disponível.');
     await query('INSERT INTO inventory_movements (id,item_id,owner_id,order_id,delta,reference,created_at,request_hash,correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [data.id, data.itemId, context!.actorId, data.orderId, -data.quantity, data.reference, now, hash, context!.correlationId]);
     const consumed = Number(row.consumed_quantity) + data.quantity;
     await query("UPDATE inventory_reservations SET consumed_quantity=$1, status=CASE WHEN $1 >= quantity THEN 'consumed' ELSE 'reserved' END WHERE id=$2 AND owner_id=$3", [consumed, data.reservationId, context!.actorId]);
     await query(`INSERT INTO inventory_consumption_events
       (id,movement_id,reservation_id,item_id,order_id,owner_id,quantity,actor_id,reference,request_hash,correlation_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [data.id, data.id, data.reservationId, data.itemId, data.orderId, context!.actorId, data.quantity, context!.actorId, data.reference, hash, context!.correlationId]);
    });
   } else {
    const delta = data.direction === 'in' ? data.quantity : -data.quantity;
    await db.transaction(async query => {
     const item = await query('SELECT id FROM inventory_items WHERE id=$1 AND owner_id=$2 FOR UPDATE', [data.itemId, context!.actorId]);
     if (!item.rowCount) throw new ApiError(404, 'NOT_FOUND', 'Material indisponível.');
     if (data.orderId) {
      const order = await query("SELECT id FROM service_orders WHERE id=$1 AND owner_id=$2 AND status='executing'", [data.orderId, context!.actorId]);
      if (!order.rowCount) throw new ApiError(409, 'ORDER_CONFLICT', 'Selecione uma OS sua em execução.');
     }
     const stock = await query('SELECT COALESCE(SUM(delta),0)::bigint AS balance FROM inventory_movements WHERE item_id=$1 AND owner_id=$2', [data.itemId, context!.actorId]);
     const balance = Number(stock.rows[0]?.balance ?? 0);
     if (balance + delta < 0 || balance + delta > 1_000_000_000_000) {
      throw new ApiError(409, 'BALANCE_CONFLICT', 'A movimentação supera o saldo disponível ou o limite de estoque.');
     }
     await query('INSERT INTO inventory_movements (id,item_id,owner_id,order_id,delta,reference,created_at,request_hash,correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [data.id, data.itemId, context!.actorId, data.orderId, delta, data.reference, now, hash, context!.correlationId]);
    });
   }
  } catch (error) {
   if (await replay()) return respond({ id: data.id, replayed: true }, context);
   const message = error instanceof Error ? error.message : '';
   if (message.includes('inventory_items.owner_id, inventory_items.sku')) throw new ApiError(409, 'SKU_EXISTS', 'Já existe um material com esse código.');
   if (message.includes('CISNE_INVENTORY_BALANCE')) throw new ApiError(409, 'BALANCE_CONFLICT', 'A movimentação supera o saldo disponível ou o limite de estoque.');
   if (message.includes('CISNE_INVENTORY_ORDER')) throw new ApiError(409, 'ORDER_CONFLICT', 'Selecione uma OS sua em execução.');
   if (message.includes('CISNE_INVENTORY_OWNER')) throw new ApiError(404, 'NOT_FOUND', 'Material indisponível.');
   if (message.includes('inventory_reservation_owner_source_item')) throw new ApiError(409, 'RESERVATION_EXISTS', 'Já existe uma reserva para este documento e material.');
   throw error;
  }
  return respond({ id: data.id }, context, 201);
 } catch (error) { return failure(error, context); }
}
