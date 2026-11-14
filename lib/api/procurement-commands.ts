import { database } from '../../db/raw';
import { ApiError, type RequestContext } from './http';

export async function procurementReplay(key: string, hash: string, actor: string) {
 const row = await database().prepare('SELECT actor_id,request_hash,result FROM procurement_commands WHERE id=?').bind(key).first<{ actor_id: string; request_hash: string; result: string }>();
 if (!row) return null;
 if (row.actor_id !== actor || row.request_hash !== hash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Chave utilizada em outra operação de suprimentos.');
 return JSON.parse(row.result) as Record<string, unknown>;
}

export function procurementReceipt(context: RequestContext, input: { key: string; type: 'supplier' | 'supplierPurchaseOrder'; id: string; command: string; hash: string; result: object; now: string }) {
 return database().prepare('INSERT INTO procurement_commands(id,actor_id,entity_type,entity_id,command,request_hash,result,correlation_id,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE changes()=1')
  .bind(input.key, context.actorId, input.type, input.id, input.command, input.hash, JSON.stringify(input.result), context.correlationId, input.now);
}
