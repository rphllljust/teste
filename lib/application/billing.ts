import { database } from '../../db/raw';
import { ApiError, type RequestContext } from '../api/http';

export type BillApprovedMeasurementInput = {
  measurementId: string;
  dueDate: string;
  commandKey: string;
  requestHash: string;
};

function storedResult(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return JSON.parse(value) as Record<string, unknown>;
  if (value && typeof value === 'object') return value as Record<string, unknown>;
  throw new ApiError(503, 'DEPENDENCY_UNAVAILABLE', 'O resultado da operação não pôde ser recuperado.');
}

export async function billApprovedMeasurement(context: RequestContext, input: BillApprovedMeasurementInput) {
  return database().transaction(async query => {
    const prior = await query(
      'SELECT request_hash,result FROM order_events WHERE id=$1',
      [input.commandKey],
    );
    if (prior.rows.length) {
      if (prior.rows[0].request_hash !== input.requestHash || !prior.rows[0].result) {
        throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Chave de comando já utilizada.');
      }
      return { ...storedResult(prior.rows[0].result), replayed: true };
    }

    const locked = await query(
      `SELECT m.id,m.order_id,m.amount,m.status,m.version,o.owner_id
         FROM measurements m
         JOIN service_orders o ON o.id=m.order_id
        WHERE m.id=$1 AND o.owner_id=$2
        FOR UPDATE`,
      [input.measurementId, context.actorId],
    );
    if (!locked.rows.length) throw new ApiError(404, 'NOT_FOUND', 'Medição não encontrada.');
    const measurement = locked.rows[0];
    if (measurement.status !== 'approved') {
      throw new ApiError(409, 'INVALID_STATE', 'Somente uma medição aprovada pode gerar faturamento.');
    }

    const now = new Date().toISOString();
    const invoiceId = crypto.randomUUID();
    const receivableId = crypto.randomUUID();
    const rowVersion = Number(measurement.version) + 1;
    const result = {
      ok: true,
      resource: {
        type: 'billingDocument',
        invoiceId,
        receivableId,
        measurementId: input.measurementId,
        orderId: String(measurement.order_id),
        amount: String(measurement.amount),
        dueDate: input.dueDate,
        rowVersion,
      },
      refreshPolicy: ['operation.workspace', 'finance.receivables', 'serviceOrder.context'],
    };

    await query(
      `INSERT INTO invoices(id,measurement_id,order_id,amount,due_date,created_at)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [invoiceId, input.measurementId, measurement.order_id, measurement.amount, input.dueDate, now],
    );
    await query(
      `INSERT INTO receivables(id,invoice_id,amount,due_date,created_at)
       VALUES($1,$2,$3,$4,$5)`,
      [receivableId, invoiceId, measurement.amount, input.dueDate, now],
    );
    await query(
      `UPDATE measurements SET status='billed',version=version+1
        WHERE id=$1 AND status='approved' AND version=$2`,
      [input.measurementId, measurement.version],
    );
    await query(
      `INSERT INTO order_events
        (id,order_id,command,version,created_at,actor_id,request_hash,target_id,result,correlation_id)
       VALUES($1,$2,'bill_measurement',$3,$4,$5,$6,$7,$8,$9)`,
      [input.commandKey, measurement.order_id, rowVersion, now, context.actorId, input.requestHash, invoiceId, JSON.stringify(result), context.correlationId],
    );
    await query(
      `INSERT INTO finance_audit_events
        (id,entity_type,entity_id,action,actor_id,request_hash,correlation_id,metadata,occurred_at)
       VALUES($1,'measurement',$2,'billing_generated',$3,$4,$5,$6,$7)`,
      [crypto.randomUUID(), input.measurementId, context.actorId, input.requestHash, context.correlationId, JSON.stringify({ invoiceId, receivableId, amount: String(measurement.amount), dueDate: input.dueDate }), now],
    );
    return { ...result, replayed: false };
  });
}
