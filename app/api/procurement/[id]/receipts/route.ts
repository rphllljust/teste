import { z } from 'zod';
import { database } from '../../../../../db/raw';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../../lib/api/http';

const body = z.object({
  key: z.string().uuid(), version: z.number().int().positive(), reference: z.string().trim().min(3).max(160),
  lines: z.array(z.object({ lineId: z.string().uuid(), accepted: z.string().trim().regex(/^\d{1,9}(?:[,.]\d{1,3})?$/), rejected: z.string().trim().regex(/^\d{1,9}(?:[,.]\d{1,3})?$/) }).strict()).min(1).max(100),
}).strict();

function qty(value: string) { const [whole, fraction = ''] = value.split(/[,.]/); return Number(whole) * 1000 + Number(fraction.padEnd(3, '0')); }

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request, true);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, 'VALIDATION_FAILED', 'Pedido inválido.');
    const parsed = body.safeParse(await jsonBody(request));
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Recebimento inválido.');
    const input = parsed.data;
    const normalized = input.lines.map(line => ({ ...line, acceptedQuantity: qty(line.accepted), rejectedQuantity: qty(line.rejected) }));
    if (normalized.some(line => line.acceptedQuantity + line.rejectedQuantity <= 0)) throw new ApiError(400, 'VALIDATION_FAILED', 'Informe quantidade aceita ou rejeitada.');
    const hash = await fingerprint({ actor: context.actorId, entity: id, scope: 'procurement.receipt', data: { ...input, lines: normalized } });
    const db = database();
    const prior = await db.prepare('SELECT actor_id AS "actorId",request_hash AS "requestHash",result FROM procurement_commands WHERE id=?').bind(input.key).first<{ actorId: string; requestHash: string; result: string }>();
    if (prior) {
      if (prior.actorId !== context.actorId || prior.requestHash !== hash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Chave utilizada em outra operação de recebimento.');
      return respond({ ...JSON.parse(prior.result), replayed: true }, context);
    }
    const receiptId = input.key;
    const now = new Date().toISOString();
    const result = { ok: true, resource: { type: 'procurementReceipt', id: receiptId, orderId: id } };
    await db.transaction(async query => {
      const order = await query('SELECT status,row_version AS "rowVersion" FROM supplier_purchase_orders WHERE id=$1 AND owner_id=$2 FOR UPDATE', [id, context!.actorId]);
      if (!order.rowCount) throw new ApiError(404, 'NOT_FOUND', 'Pedido indisponível.');
      const current = order.rows[0] as { status: string; rowVersion: number };
      if (current.status !== 'approved') throw new ApiError(409, 'STATE_CONFLICT', 'Somente pedidos aprovados podem ser recebidos.');
      if (Number(current.rowVersion) !== input.version) throw new ApiError(409, 'VERSION_CONFLICT', 'O pedido mudou; atualize antes de receber.');
      await query('INSERT INTO procurement_receipts(id,order_id,owner_id,reference,created_at,request_hash,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7)', [receiptId, id, context!.actorId, input.reference, now, hash, context!.correlationId]);
      for (const line of normalized) {
        const stored = await query(`SELECT l.item_id AS "itemId",l.quantity,
          COALESCE((SELECT SUM(accepted_quantity) FROM procurement_receipt_lines WHERE order_line_id=l.id),0) AS accepted,
          COALESCE((SELECT SUM(rejected_quantity) FROM procurement_receipt_lines WHERE order_line_id=l.id),0) AS rejected
          FROM supplier_purchase_order_lines l WHERE l.id=$1 AND l.order_id=$2 AND l.owner_id=$3`, [line.lineId, id, context!.actorId]);
        if (!stored.rowCount) throw new ApiError(404, 'NOT_FOUND', 'Item do pedido indisponível.');
        const currentLine = stored.rows[0] as { itemId: string; quantity: number; accepted: number; rejected: number };
        if (Number(currentLine.accepted) + Number(currentLine.rejected) + line.acceptedQuantity + line.rejectedQuantity > Number(currentLine.quantity)) throw new ApiError(409, 'QUANTITY_CONFLICT', 'O recebimento supera a quantidade do pedido.');
        const receiptLineId = crypto.randomUUID();
        await query('INSERT INTO procurement_receipt_lines(id,receipt_id,order_line_id,item_id,accepted_quantity,rejected_quantity,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [receiptLineId, receiptId, line.lineId, currentLine.itemId, line.acceptedQuantity, line.rejectedQuantity, now]);
        if (line.acceptedQuantity > 0) await query(`INSERT INTO inventory_movements(id,item_id,owner_id,delta,reference,created_at,request_hash,correlation_id,procurement_order_id,procurement_receipt_line_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [crypto.randomUUID(), currentLine.itemId, context!.actorId, line.acceptedQuantity, `${input.reference} · recebimento`, now, hash, context!.correlationId, id, receiptLineId]);
      }
      const complete = await query(`SELECT NOT EXISTS (SELECT 1 FROM supplier_purchase_order_lines l WHERE l.order_id=$1 AND l.owner_id=$2 AND
        COALESCE((SELECT SUM(accepted_quantity+rejected_quantity) FROM procurement_receipt_lines WHERE order_line_id=l.id),0) < l.quantity) AS complete`, [id, context!.actorId]);
      const status = (complete.rows[0] as { complete: boolean }).complete ? 'received' : 'approved';
      await query('UPDATE supplier_purchase_orders SET status=$1,row_version=row_version+1,received_at=CASE WHEN $1=\'received\' THEN $2 ELSE received_at END,updated_at=$2 WHERE id=$3 AND owner_id=$4', [status, now, id, context!.actorId]);
      await query(`INSERT INTO procurement_commands(id,actor_id,entity_type,entity_id,command,request_hash,result,correlation_id,created_at)
        VALUES($1,$2,'supplierPurchaseOrder',$3,'receive',$4,$5,$6,$7)`, [input.key, context!.actorId, id, hash, JSON.stringify({ ...result, status }), context!.correlationId, now]);
    });
    return respond(result, context, 201);
  } catch (error) { return failure(error, context); }
}
