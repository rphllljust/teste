import { z } from 'zod';
import { database } from '../../../db/raw';
import { ApiError, failure, fingerprint, jsonBody, requestContext, respond, type RequestContext, validDate } from '../../../lib/api/http';
import { transitions, parseAmount } from '../../../lib/domain/orders';
import { enqueueOutboxEvent } from '../../../lib/infrastructure/outbox';

const input = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  key: z.string().uuid(),
  command: z.enum(['authorize', 'start', 'complete', 'cancel', 'measure', 'approve_measurement', 'invoice']),
  description: z.string().trim().min(3).max(4000).optional(),
  amount: z.string().trim().regex(/^\d{1,10}(?:,\d{1,4})?$/).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  evidenceIds: z.array(z.string().uuid()).max(50).optional(),
}).strict();

function eventResult(id: string, type: string, rowVersion: number) {
  return { ok: true, id, resource: { type, id, rowVersion }, refreshPolicy: ['serviceOrders.worklist', 'serviceOrder.context', 'operation.workspace', 'finance.receivables'] };
}

async function publishOrderEvent(query: Parameters<typeof enqueueOutboxEvent>[0], orderId: string, command: string, version: number, actorId: string, correlationId: string, result: Record<string, unknown>, occurredAt: string) {
  await enqueueOutboxEvent(query, { id: crypto.randomUUID(), aggregateType: 'serviceOrder', aggregateId: orderId, eventType: `serviceOrder.${command}`, aggregateVersion: version, payload: { ...result, actorId, command }, correlationId, occurredAt });
}

export async function POST(request: Request) {
  let context: RequestContext | undefined;
  let replayed = false;
  try {
    context = requestContext(request, true);
    const parsed = input.safeParse(await jsonBody(request));
    if (!parsed.success) throw new ApiError(400, 'VALIDATION_FAILED', 'Comando operacional inválido.');
    const p = parsed.data;
    if (p.dueDate && !validDate(p.dueDate)) throw new ApiError(400, 'VALIDATION_FAILED', 'Vencimento inválido.');
    if (p.command === 'measure' && (!p.description || !p.amount)) throw new ApiError(400, 'VALIDATION_FAILED', 'Descrição e valor da medição são obrigatórios.');
    if (p.command === 'invoice' && !p.dueDate) throw new ApiError(400, 'VALIDATION_FAILED', 'Vencimento da cobrança é obrigatório.');
    const amount = p.amount ? parseAmount(p.amount) : null;
    if (p.command === 'measure' && amount === null) throw new ApiError(400, 'VALIDATION_FAILED', 'Valor da medição inválido.');
    const requestHash = await fingerprint({ actor: context.actorId, scope: 'command', payload: p });

    const result = await database().transaction(async query => {
      const prior = await query('SELECT request_hash,result FROM order_events WHERE id=$1', [p.key]);
      if (prior.rows.length) {
        if (prior.rows[0].request_hash !== requestHash || !prior.rows[0].result) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Chave de comando já utilizada.');
        replayed = true;
        return JSON.parse(String(prior.rows[0].result)) as Record<string, unknown>;
      }

      if (['authorize', 'start', 'complete', 'cancel', 'measure'].includes(p.command)) {
        // Operational commands are tenant/owner scoped. Legacy ownerless rows
        // may remain readable for migration purposes, but they must never be
        // mutated by an authenticated actor.
        const rows = await query('SELECT id,owner_id,status,version FROM service_orders WHERE id=$1 AND owner_id=$2 FOR UPDATE', [p.id, context!.actorId]);
        if (!rows.rows.length) throw new ApiError(404, 'NOT_FOUND', 'Ordem de serviço não encontrada.');
        const order = rows.rows[0] as { id: string; owner_id: string | null; status: string; version: number };
        if (order.version !== p.version) throw new ApiError(409, 'VERSION_CONFLICT', 'A ordem mudou. Atualize o contexto.');
        if (p.command === 'measure') {
          if (order.status !== 'completed') throw new ApiError(409, 'INVALID_STATE', 'A medição exige uma OS concluída.');
          const measurementId = crypto.randomUUID();
          const now = new Date().toISOString();
          await query('INSERT INTO measurements(id,order_id,description,amount,status,version,created_at) VALUES($1,$2,$3,$4,\'draft\',1,$5)', [measurementId, p.id, p.description, amount, now]);
          await query('INSERT INTO order_events(id,order_id,command,version,created_at,actor_id,request_hash,target_id,result,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [p.key, p.id, p.command, order.version, now, context!.actorId, requestHash, measurementId, JSON.stringify(eventResult(measurementId, 'measurement', 1)), context!.correlationId]);
          await publishOrderEvent(query, p.id, p.command, order.version, context!.actorId, context!.correlationId, eventResult(measurementId, 'measurement', 1), now);
          return eventResult(measurementId, 'measurement', 1);
        }
        const transition = transitions[p.command];
        if (!transition || !transition.from.includes(order.status)) throw new ApiError(409, 'INVALID_STATE', 'A transição não é permitida para o estado atual.');
        const nextVersion = order.version + 1;
        const now = new Date().toISOString();
        await query('UPDATE service_orders SET status=$1,version=$2 WHERE id=$3 AND version=$4', [transition.to, nextVersion, p.id, p.version]);
        const result = eventResult(p.id, 'serviceOrder', nextVersion);
        await query('INSERT INTO order_events(id,order_id,command,version,created_at,actor_id,request_hash,target_id,result,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [p.key, p.id, p.command, nextVersion, now, context!.actorId, requestHash, p.id, JSON.stringify(result), context!.correlationId]);
        await publishOrderEvent(query, p.id, p.command, nextVersion, context!.actorId, context!.correlationId, result, now);
        return result;
      }

      const measurementRows = await query('SELECT m.id,m.order_id,m.amount,m.status,m.version,o.owner_id FROM measurements m JOIN service_orders o ON o.id=m.order_id WHERE m.id=$1 AND (o.owner_id IS NULL OR o.owner_id=$2) FOR UPDATE', [p.id, context!.actorId]);
      if (!measurementRows.rows.length) throw new ApiError(404, 'NOT_FOUND', 'Medição não encontrada.');
      const measurement = measurementRows.rows[0] as { id: string; order_id: string; amount: number; status: string; version: number; owner_id: string | null };
      if (measurement.version !== p.version) throw new ApiError(409, 'VERSION_CONFLICT', 'A medição mudou. Atualize o contexto.');
      const now = new Date().toISOString();
      if (p.command === 'approve_measurement') {
        if (measurement.status !== 'draft') throw new ApiError(409, 'INVALID_STATE', 'Somente uma medição em rascunho pode ser aprovada.');
        await query('UPDATE measurements SET status=\'approved\',version=version+1 WHERE id=$1 AND version=$2', [p.id, p.version]);
        const result = eventResult(p.id, 'measurement', p.version + 1);
        await query('INSERT INTO order_events(id,order_id,command,version,created_at,actor_id,request_hash,target_id,result,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [p.key, measurement.order_id, p.command, p.version + 1, now, context!.actorId, requestHash, p.id, JSON.stringify(result), context!.correlationId]);
        await publishOrderEvent(query, measurement.order_id, p.command, p.version + 1, context!.actorId, context!.correlationId, result, now);
        return result;
      }
      if (measurement.status !== 'approved') throw new ApiError(409, 'INVALID_STATE', 'Somente uma medição aprovada pode gerar cobrança.');
      const invoiceId = crypto.randomUUID();
      const receivableId = crypto.randomUUID();
      await query('INSERT INTO invoices(id,measurement_id,order_id,amount,due_date,created_at) VALUES($1,$2,$3,$4,$5,$6)', [invoiceId, p.id, measurement.order_id, measurement.amount, p.dueDate, now]);
      await query('INSERT INTO receivables(id,invoice_id,amount,due_date,created_at) VALUES($1,$2,$3,$4,$5)', [receivableId, invoiceId, measurement.amount, p.dueDate, now]);
      await query('UPDATE measurements SET status=\'billed\',version=version+1 WHERE id=$1 AND version=$2', [p.id, p.version]);
      const result = { ...eventResult(p.id, 'invoice', p.version + 1), resource: { type: 'invoice', id: invoiceId, receivableId, measurementId: p.id, rowVersion: p.version + 1 } };
      await query('INSERT INTO order_events(id,order_id,command,version,created_at,actor_id,request_hash,target_id,result,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [p.key, measurement.order_id, p.command, p.version + 1, now, context!.actorId, requestHash, invoiceId, JSON.stringify(result), context!.correlationId]);
      await publishOrderEvent(query, measurement.order_id, p.command, p.version + 1, context!.actorId, context!.correlationId, result, now);
      return result;
    });
    return respond(result, context, replayed ? 200 : 201);
  } catch (error) {
    return failure(error, context);
  }
}

