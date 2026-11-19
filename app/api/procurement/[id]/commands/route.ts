import { z } from 'zod';
import { database } from '../../../../../db/raw';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext } from '../../../../../lib/api/http';

const body = z.object({ key: z.string().uuid(), version: z.number().int().positive(), command: z.enum(['approve', 'cancel']) }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request, true);
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, 'VALIDATION_FAILED', 'Pedido inválido.');
    const parsed = body.safeParse(await jsonBody(request));
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Comando de compras inválido.');
    const input = parsed.data;
    const hash = await fingerprint({ actor: context.actorId, entity: id, scope: 'procurement.command', data: input });
    const db = database();
    const prior = await db.prepare('SELECT actor_id AS "actorId",request_hash AS "requestHash",result FROM procurement_commands WHERE id=?').bind(input.key).first<{ actorId: string; requestHash: string; result: string }>();
    if (prior) {
      if (prior.actorId !== context.actorId || prior.requestHash !== hash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Chave utilizada em outra operação de compras.');
      return respond({ ...JSON.parse(prior.result), replayed: true }, context);
    }
    const now = new Date().toISOString();
    const nextStatus = input.command === 'approve' ? 'approved' : 'cancelled';
    const result = { ok: true, resource: { type: 'supplierPurchaseOrder', id, rowVersion: input.version + 1, status: nextStatus } };
    await db.transaction(async query => {
      const updated = await query(`UPDATE supplier_purchase_orders SET status=$1,row_version=row_version+1,updated_at=$2
        WHERE id=$3 AND owner_id=$4 AND row_version=$5 AND status = ANY($6::text[])`, [nextStatus, now, id, context!.actorId, input.version, input.command === 'approve' ? ['draft'] : ['draft', 'approved']]);
      if (updated.rowCount !== 1) throw new ApiError(409, 'VERSION_CONFLICT', 'O pedido mudou ou não permite este comando.');
      await query(`INSERT INTO procurement_commands(id,actor_id,entity_type,entity_id,command,request_hash,result,correlation_id,created_at)
        VALUES($1,$2,'supplierPurchaseOrder',$3,$4,$5,$6,$7,$8)`, [input.key, context!.actorId, id, input.command, hash, JSON.stringify(result), context!.correlationId, now]);
    });
    return respond(result, context);
  } catch (error) { return failure(error, context); }
}
