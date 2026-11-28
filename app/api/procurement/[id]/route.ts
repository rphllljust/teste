import { z } from 'zod';
import { database } from '../../../../db/raw';
import { ApiError, failure, requestContext, respond, type RequestContext } from '../../../../lib/api/http';
import { verifyProcurementReceiptEvidence } from '../../../../lib/domain/procurement-receipt-evidence.mjs';

const idSchema = z.string().uuid();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const { id } = await params;
    if (!idSchema.safeParse(id).success) throw new ApiError(400, 'VALIDATION_FAILED', 'Pedido inválido.');
    const db = database();
    const result = await db.batch([
      db.prepare(`SELECT p.id,p.reference,p.total,p.expected_on AS "expectedOn",p.status,
        p.row_version AS "rowVersion",p.created_at AS "createdAt",p.received_at AS "receivedAt",
        s.id AS "supplierId",s.legal_name AS supplier
        FROM supplier_purchase_orders p JOIN suppliers s ON s.id=p.supplier_id
        WHERE p.id=? AND p.owner_id=?`).bind(id, context.actorId),
      db.prepare(`SELECT l.id,l.item_id AS "itemId",i.name AS item,i.sku,i.unit,l.quantity,l.unit_price AS "unitPrice",
        l.discount,l.tax,l.subtotal,
        COALESCE((SELECT SUM(im.delta)::bigint FROM inventory_movements im
          JOIN procurement_receipt_lines rl ON rl.id=im.procurement_receipt_line_id
          JOIN procurement_receipts pr ON pr.id=rl.receipt_id
            AND pr.order_id=l.order_id AND pr.owner_id=l.owner_id
          WHERE rl.order_line_id=l.id AND im.owner_id=l.owner_id
            AND im.procurement_order_id=l.order_id AND im.item_id=l.item_id),0)::text AS "stockQuantity",
        (SELECT COUNT(*)::int FROM inventory_movements im
          JOIN procurement_receipt_lines rl ON rl.id=im.procurement_receipt_line_id
          JOIN procurement_receipts pr ON pr.id=rl.receipt_id
            AND pr.order_id=l.order_id AND pr.owner_id=l.owner_id
          WHERE rl.order_line_id=l.id AND im.owner_id=l.owner_id
            AND im.procurement_order_id=l.order_id AND im.item_id=l.item_id) AS "movementCount",
        COALESCE((SELECT SUM(r.accepted_quantity) FROM procurement_receipt_lines r
          JOIN procurement_receipts pr ON pr.id=r.receipt_id
          WHERE r.order_line_id=l.id AND pr.owner_id=?),0) AS "receivedQuantity",
        COALESCE((SELECT SUM(r.rejected_quantity) FROM procurement_receipt_lines r
          JOIN procurement_receipts pr ON pr.id=r.receipt_id
          WHERE r.order_line_id=l.id AND pr.owner_id=?),0) AS "rejectedQuantity"
        FROM supplier_purchase_order_lines l JOIN inventory_items i ON i.id=l.item_id AND i.owner_id=l.owner_id
        WHERE l.order_id=? AND l.owner_id=? ORDER BY l.position,l.id`).bind(context.actorId, context.actorId, id, context.actorId),
      db.prepare(`SELECT pr.id,pr.reference,pr.created_at AS "createdAt",
        COALESCE(SUM(rl.accepted_quantity),0) AS "acceptedQuantity",
        COALESCE(SUM(rl.rejected_quantity),0) AS "rejectedQuantity"
        FROM procurement_receipts pr LEFT JOIN procurement_receipt_lines rl ON rl.receipt_id=pr.id
        WHERE pr.order_id=? AND pr.owner_id=? GROUP BY pr.id,pr.reference,pr.created_at
        ORDER BY pr.created_at DESC,pr.id DESC`).bind(id, context.actorId),
      db.prepare(`SELECT COUNT(*) FILTER (WHERE im.procurement_order_id=?)::int AS "linkedMovements",
        COALESCE(SUM(im.delta) FILTER (WHERE im.procurement_order_id=?),0)::bigint AS "linkedQuantity"
        FROM inventory_movements im WHERE im.owner_id=?`).bind(id, id, context.actorId),
    ]);
    if (!result[0].results.length) throw new ApiError(404, 'NOT_FOUND', 'Pedido indisponível.');
    const order = result[0].results[0];
    const lines = result[1].results;
    const receipts = result[2].results;
    const movements = result[3].results[0] as { linkedMovements: number; linkedQuantity: number };
    // Three-way control is evaluated per PO line and inventory receipt line,
    // not by a total that can hide offsetting stock postings across items.
    const receiptEvidence = verifyProcurementReceiptEvidence(lines, {
      receiptCount: receipts.length,
      linkedMovements: movements.linkedMovements,
      linkedQuantity: movements.linkedQuantity,
    });
    return respond({ order, lines, receipts, reconciled: receiptEvidence.reconciled,
      receiptEvidence }, context);
  } catch (error) { return failure(error, context); }
}
