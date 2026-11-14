import { database } from '../../db/raw';
import { ApiError, type RequestContext } from '../api/http';
import { procurementReceipt } from '../api/procurement-commands';

// Shared purchase-order command: both the Procurement screen and MRP use the
// same valuation, line-writing and durable procurement-command contract.
// Quantities are integer thousandths; monetary amounts are integer ten-thousandths.
export type PurchaseLine = {
 id: string; itemId: string; quantity: number; unitPrice: number;
 discount: number; tax: number;
};
export type PurchaseOrderInput = {
 id: string; supplierId: string; reference: string; expectedOn: string;
 lines: PurchaseLine[]; freight: number; additionalCosts: number;
};
export type MrpPurchaseSource = {
 recommendationId: string; expectedVersion: number; materialId: string; quantity: number;
};

export function pricePurchaseOrder(input: PurchaseOrderInput) {
 if (!input.lines.length || input.lines.length > 30) throw new ApiError(400, 'VALIDATION_FAILED', 'O pedido precisa conter de 1 a 30 itens.');
 for (const amount of [input.freight, input.additionalCosts])
  if (!Number.isSafeInteger(amount) || amount < 0) throw new ApiError(400, 'VALIDATION_FAILED', 'Encargos inválidos.');
 const lines = input.lines.map((line, position) => {
  for (const n of [line.quantity, line.unitPrice, line.discount, line.tax])
   if (!Number.isSafeInteger(n) || n < 0) throw new ApiError(400, 'VALIDATION_FAILED', 'Valores de item inválidos.');
  if (!line.quantity || !line.unitPrice) throw new ApiError(400, 'VALIDATION_FAILED', 'Quantidade e preço devem ser positivos.');
  const subtotal = Math.round(line.quantity * line.unitPrice / 1000) - line.discount + line.tax;
  if (!Number.isSafeInteger(subtotal) || subtotal <= 0) throw new ApiError(400, 'VALIDATION_FAILED', 'Subtotal de compra inválido.');
  return { ...line, position: position + 1, subtotal };
 });
 const total = lines.reduce((sum, line) => sum + line.subtotal, 0) + input.freight + input.additionalCosts;
 if (!Number.isSafeInteger(total) || total <= 0) throw new ApiError(400, 'VALIDATION_FAILED', 'Total do pedido inválido.');
 return { lines, total };
}

export async function createPurchaseOrder(
 context: RequestContext, input: PurchaseOrderInput, hash: string, source?: MrpPurchaseSource,
) {
 const db = database();
 const { lines, total } = pricePurchaseOrder(input);
 if (source && (lines.length !== 1 || lines[0].itemId !== source.materialId || lines[0].quantity !== source.quantity))
  throw new ApiError(409, 'MRP_REQUIREMENT_CHANGED', 'O pedido não corresponde à recomendação aprovada.');
 const now = new Date().toISOString();
 const first = lines[0];
 const result = { ok: true, resource: { type: 'supplierPurchaseOrder' as const, id: input.id, rowVersion: 1 } };
 // D1 batch executes these statements as one transaction. Only a successful
 // guarded recommendation transition can create the linked purchasing record.
 const transition = source
  ? db.prepare(`UPDATE mrp_recommendations
       SET status='converted', purchase_order_id=?, row_version=row_version+1, updated_at=?
       WHERE id=? AND owner_id=? AND status='approved' AND row_version=?
         AND purchase_order_id IS NULL AND material_id=? AND net_requirement=?
         AND EXISTS (SELECT 1 FROM suppliers WHERE id=? AND owner_id=? AND status='active')
         AND EXISTS (SELECT 1 FROM inventory_items WHERE id=? AND owner_id=?)`)
      .bind(input.id, now, source.recommendationId, context.actorId, source.expectedVersion,
       source.materialId, source.quantity, input.supplierId, context.actorId, source.materialId, context.actorId)
  : null;
 const values = [input.id, context.actorId, input.supplierId, first.itemId, input.reference,
  first.quantity, first.unitPrice, total, input.expectedOn, 'BRL', input.freight,
  input.additionalCosts, now, now, hash] as const;
 const orderStatement = source
  ? db.prepare(`INSERT INTO supplier_purchase_orders
       (id,owner_id,supplier_id,item_id,reference,quantity,unit_price,total,expected_on,currency,freight,additional_costs,created_at,updated_at,request_hash)
       SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM mrp_recommendations r
       WHERE r.id=? AND r.owner_id=? AND r.purchase_order_id=? AND r.status='converted'
         AND r.row_version=? AND changes()=1`)
       .bind(...values, source.recommendationId, context.actorId, input.id, source.expectedVersion + 1)
  : db.prepare(`INSERT INTO supplier_purchase_orders
       (id,owner_id,supplier_id,item_id,reference,quantity,unit_price,total,expected_on,currency,freight,additional_costs,created_at,updated_at,request_hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...values);
 const lineStatements = lines.map(line => {
  const statement = source
   ? `INSERT INTO supplier_purchase_order_lines
       (id,order_id,owner_id,item_id,position,quantity,unit_price,discount,tax,subtotal,created_at)
       SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE changes()=1`
   : `INSERT INTO supplier_purchase_order_lines
       (id,order_id,owner_id,item_id,position,quantity,unit_price,discount,tax,subtotal,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`;
  return db.prepare(statement).bind(line.id, input.id, context.actorId, line.itemId,
   line.position, line.quantity, line.unitPrice, line.discount, line.tax, line.subtotal, now);
 });
 const statements = [
  ...(transition ? [transition] : []),
  orderStatement,
  ...lineStatements,
  procurementReceipt(context, { key: input.id, type: 'supplierPurchaseOrder', id: input.id,
   command: 'register', hash, result, now }),
  ...(source ? [db.prepare(`INSERT INTO mrp_events
    (id,recommendation_id,owner_id,actor_id,command,from_status,to_status,purchase_order_id,correlation_id,created_at)
    SELECT ?,?,?,?,?,?,?,?,?,? FROM mrp_recommendations r
    WHERE r.id=? AND r.owner_id=? AND r.purchase_order_id=? AND r.status='converted'
      AND r.row_version=? AND changes()=1`)
    .bind(crypto.randomUUID(),source.recommendationId,context.actorId,context.actorId,'convert',
      'approved','converted',input.id,context.correlationId,now,
      source.recommendationId,context.actorId,input.id,source.expectedVersion+1)] : []),
 ];
 const outcomes = await db.batch(statements);
 // If the compare-and-swap failed, no purchasing statement could insert a row.
 // A missing source order must never be reported as a successful conversion.
 if (source && (outcomes[0].meta.changes !== 1 || outcomes[1].meta.changes !== 1 || outcomes[outcomes.length-1].meta.changes !== 1))
  throw new ApiError(409, 'VERSION_CONFLICT', 'A recomendação mudou; atualize antes de converter.');
 return result;
}
