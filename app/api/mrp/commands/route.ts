import { z } from 'zod';
import { database } from '../../../../db/raw';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, validDate, type RequestContext } from '../../../../lib/api/http';
import { procurementReplay } from '../../../../lib/api/procurement-commands';
import { createPurchaseOrder } from '../../../../lib/application/procurement';

const uuid = z.string().uuid();
const base = { recommendationId: uuid, expectedVersion: z.number().int().positive() };
const money = z.string().trim().regex(/^\d{1,9}(?:[,.]\d{1,4})?$/)
 .transform(value => {
  const [whole, fraction = ''] = value.split(/[,.]/);
  return Number(whole) * 10000 + Number(fraction.padEnd(4, '0'));
 }).refine(value => Number.isSafeInteger(value) && value > 0);
const command = z.discriminatedUnion('command', [
 z.object({ ...base, command: z.literal('approve') }).strict(),
 z.object({ ...base, command: z.literal('reject') }).strict(),
 z.object({
  ...base, command: z.literal('convert'), purchaseOrderId: uuid, lineId: uuid,
  supplierId: uuid, reference: z.string().trim().min(3).max(80),
  expectedOn: z.string().refine(validDate), unitPrice: money,
 }).strict(),
]);

type StoredRecommendation = {
 id: string; status: string; row_version: number; material_id: string;
 net_requirement: number; purchase_order_id: string | null;
};
export async function POST(request: Request) {
 let context: RequestContext | undefined;
 try {
  context = requestContext(request, true);
  const parsed = command.safeParse(await jsonBody(request));
  if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Revise os dados da operação MRP.');
  const data = parsed.data;
  const db = database();
  const rec = await db.prepare(
   'SELECT id,status,row_version,material_id,net_requirement,purchase_order_id FROM mrp_recommendations WHERE id=? AND owner_id=?'
  ).bind(data.recommendationId, context.actorId).first<StoredRecommendation>();
  if (!rec) throw new ApiError(404, 'NOT_FOUND', 'Recomendação não encontrada.');

  if (data.command === 'convert') {
   const hash = await fingerprint({ actor: context.actorId, scope: 'mrp.convert', command: data });
   const replay = await procurementReplay(data.purchaseOrderId, hash, context.actorId);
   if (replay) return respond({ ...replay, recommendationId: rec.id, purchaseOrderId: data.purchaseOrderId, replayed: true }, context);
   if (rec.status !== 'approved' || rec.row_version !== data.expectedVersion)
    throw new ApiError(409, 'VERSION_CONFLICT', 'Atualize a recomendação antes de criar o pedido.');
   if (!Number.isSafeInteger(rec.net_requirement) || rec.net_requirement <= 0)
    throw new ApiError(409, 'INVALID_STATE', 'A recomendação não possui quantidade válida.');
   if (data.purchaseOrderId === data.lineId)
    throw new ApiError(400, 'VALIDATION_FAILED', 'Identificadores de pedido e item devem ser diferentes.');
   const supplier = await db.prepare(
    "SELECT id FROM suppliers WHERE id=? AND owner_id=? AND status='active'"
   ).bind(data.supplierId, context.actorId).first();
   if (!supplier) throw new ApiError(409, 'INVALID_SUPPLIER', 'Selecione um fornecedor ativo.');
   const result = await createPurchaseOrder(context, {
    id: data.purchaseOrderId, supplierId: data.supplierId,
    reference: data.reference, expectedOn: data.expectedOn, freight: 0, additionalCosts: 0,
    lines: [{ id: data.lineId, itemId: rec.material_id, quantity: rec.net_requirement,
     unitPrice: data.unitPrice, discount: 0, tax: 0 }],
   }, hash, { recommendationId: rec.id, expectedVersion: data.expectedVersion,
    materialId: rec.material_id, quantity: rec.net_requirement });
   return respond({ ...result, recommendationId: rec.id, purchaseOrderId: data.purchaseOrderId }, context, 201);
  }

  if (rec.status !== 'draft' || rec.row_version !== data.expectedVersion)
   throw new ApiError(409, 'VERSION_CONFLICT', 'Atualize a recomendação antes de decidir.');
  const target = data.command === 'approve' ? 'approved' : 'rejected';
  const now = new Date().toISOString();
  const results = await db.batch([
   db.prepare(`UPDATE mrp_recommendations SET status=?,updated_at=?,row_version=row_version+1
     WHERE id=? AND owner_id=? AND status='draft' AND row_version=?
       AND EXISTS(SELECT 1 FROM mrp_runs WHERE id=mrp_recommendations.run_id AND owner_id=? AND status='completed')`)
    .bind(target, now, rec.id, context.actorId, data.expectedVersion, context.actorId),
   db.prepare(`INSERT INTO mrp_events
     (id,recommendation_id,owner_id,actor_id,command,from_status,to_status,purchase_order_id,correlation_id,created_at)
     SELECT ?,?,?,?,?,?,?,?,?,? FROM mrp_recommendations
     WHERE id=? AND owner_id=? AND status=? AND row_version=? AND changes()=1`)
    .bind(crypto.randomUUID(), rec.id, context.actorId, context.actorId, data.command,
     'draft', target, null, context.correlationId, now,
     rec.id, context.actorId, target, data.expectedVersion + 1),
  ]);
  if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1)
   throw new ApiError(409, 'VERSION_CONFLICT', 'A recomendação foi alterada por outra operação.');
  return respond({ recommendationId: rec.id, approvalStatus: target,
   rowVersion: data.expectedVersion + 1 }, context);
 } catch (error) { return failure(error, context); }
}
