import { database } from '../../db/raw';
import { ApiError, type RequestContext } from '../api/http';

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
const audit = (query: Query, context: RequestContext, entityType: string, entityId: string, action: string, requestHash: string, metadata: Record<string, unknown>) => query(`INSERT INTO finance_audit_events (id,entity_type,entity_id,action,actor_id,request_hash,correlation_id,metadata,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [crypto.randomUUID(), entityType, entityId, action, context.actorId, requestHash, context.correlationId, JSON.stringify(metadata), new Date().toISOString()]);

export type SettlementInput = {
  receivableId: string;
  amount: number;
  effectiveDate: string;
  reference: string;
  commandKey: string;
  requestHash: string;
};

export async function registerReceivableSettlement(context: RequestContext, input: SettlementInput) {
  return database().transaction(query => registerReceivableSettlementWithQuery(query, context, input));
}

export async function registerReceivableSettlementWithQuery(query: Query, context: RequestContext, input: SettlementInput) {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new ApiError(400, 'VALIDATION_FAILED', 'O valor da baixa deve ser positivo.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate)) throw new ApiError(400, 'VALIDATION_FAILED', 'A data da baixa é inválida.');
  if (!input.commandKey || !input.requestHash) throw new ApiError(400, 'VALIDATION_FAILED', 'A operação precisa de idempotência.');

  const prior = await query('SELECT id, receivable_id, amount, effective_date, reference, request_hash FROM receivable_settlements WHERE id=$1', [input.commandKey]);
  if (prior.rows.length) {
    const row = prior.rows[0];
    if (row.request_hash !== input.requestHash || row.receivable_id !== input.receivableId) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Chave utilizada em outra operação.');
    return { ok: true, replayed: true, resource: { type: 'receivableSettlement', id: row.id, receivableId: row.receivable_id, amount: String(row.amount), effectiveDate: row.effective_date, reference: row.reference } };
  }

  const receivable = await query(`SELECT r.id, r.amount,
    COALESCE((SELECT SUM(CASE WHEN s.kind='receipt' THEN s.amount ELSE -s.amount END)
      FROM receivable_settlements s WHERE s.receivable_id=r.id),0) AS settled
    FROM receivables r WHERE r.id=$1 FOR UPDATE`, [input.receivableId]);
  if (!receivable.rows.length) throw new ApiError(404, 'NOT_FOUND', 'Título financeiro não encontrado.');
  const row = receivable.rows[0];
  const balance = Number(row.amount) - Number(row.settled);
  if (input.amount > balance) throw new ApiError(409, 'SETTLEMENT_EXCEEDS_BALANCE', 'A baixa excede o saldo do título.');

  await query(`INSERT INTO receivable_settlements
    (id, receivable_id, kind, amount, effective_date, reference, created_at, actor_id, request_hash, correlation_id)
    VALUES ($1,$2,'receipt',$3,$4,$5,$6,$7,$8,$9)`,
    [input.commandKey, input.receivableId, input.amount, input.effectiveDate, input.reference,
      new Date().toISOString(), context.actorId, input.requestHash, context.correlationId]);
  await audit(query, context, 'receivable', input.receivableId, 'receipt_registered', input.requestHash, { settlementId: input.commandKey, amount: input.amount, reference: input.reference });

  return { ok: true, replayed: false, resource: { type: 'receivableSettlement', id: input.commandKey, receivableId: input.receivableId, amount: String(input.amount), balance: String(balance - input.amount) } };
}

export async function reverseReceivableSettlement(context: RequestContext, input: { settlementId: string; commandKey: string; requestHash: string; effectiveDate: string; reference: string }) {
  return database().transaction(async query => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate)) throw new ApiError(400, 'VALIDATION_FAILED', 'A data do estorno é inválida.');
    const prior = await query('SELECT id, receivable_id, amount, request_hash FROM receivable_settlements WHERE id=$1', [input.commandKey]);
    if (prior.rows.length) {
      const row = prior.rows[0];
      if (row.request_hash !== input.requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Chave utilizada em outra operação.');
      return { ok: true, replayed: true, resource: { type: 'receivableReversal', id: row.id, receivableId: row.receivable_id, amount: String(row.amount) } };
    }
    const original = await query(`SELECT s.id, s.receivable_id, s.amount, r.id AS title_id
      FROM receivable_settlements s JOIN receivables r ON r.id=s.receivable_id
      WHERE s.id=$1 AND s.kind='receipt' FOR UPDATE`, [input.settlementId]);
    if (!original.rows.length) throw new ApiError(404, 'NOT_FOUND', 'Baixa não encontrada.');
    const row = original.rows[0];
    const alreadyReversed = await query("SELECT 1 FROM receivable_settlements WHERE reverses_id=$1", [input.settlementId]);
    if (alreadyReversed.rows.length) throw new ApiError(409, 'SETTLEMENT_ALREADY_REVERSED', 'Esta baixa já foi estornada.');
    await query(`INSERT INTO receivable_settlements
      (id, receivable_id, kind, amount, effective_date, reference, reverses_id, created_at, actor_id, request_hash, correlation_id)
      VALUES ($1,$2,'reversal',$3,$4,$5,$6,$7,$8,$9,$10)`,
      [input.commandKey, row.receivable_id, row.amount, input.effectiveDate, input.reference, input.settlementId,
        new Date().toISOString(), context.actorId, input.requestHash, context.correlationId]);
    await audit(query, context, 'receivable', row.receivable_id as string, 'receipt_reversed', input.requestHash, { settlementId: input.settlementId, reversalId: input.commandKey, reference: input.reference });
    return { ok: true, replayed: false, resource: { type: 'receivableReversal', id: input.commandKey, receivableId: row.receivable_id, amount: String(row.amount) } };
  });
}

export async function registerPayablePayment(context: RequestContext, input: { payableId: string; amount: number; effectiveDate: string; reference: string; commandKey: string; requestHash: string }) {
  return database().transaction(async query => {
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new ApiError(400, 'VALIDATION_FAILED', 'O valor do pagamento deve ser positivo.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate)) throw new ApiError(400, 'VALIDATION_FAILED', 'A data do pagamento é inválida.');
    const prior = await query('SELECT id, payable_id, amount, request_hash FROM payable_payments WHERE id=$1', [input.commandKey]);
    if (prior.rows.length) {
      const row = prior.rows[0];
      if (row.request_hash !== input.requestHash || row.payable_id !== input.payableId) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Chave utilizada em outra operação.');
      return { ok: true, replayed: true, resource: { type: 'payablePayment', id: row.id, payableId: row.payable_id, amount: String(row.amount) } };
    }
    const payable = await query(`SELECT p.id, p.amount,
      COALESCE((SELECT SUM(CASE WHEN x.kind='payment' THEN x.amount ELSE -x.amount END)
        FROM payable_payments x WHERE x.payable_id=p.id),0) AS settled
      FROM payables p WHERE p.id=$1 FOR UPDATE`, [input.payableId]);
    if (!payable.rows.length) throw new ApiError(404, 'NOT_FOUND', 'Título a pagar não encontrado.');
    const row = payable.rows[0];
    const balance = Number(row.amount) - Number(row.settled);
    if (input.amount > balance) throw new ApiError(409, 'PAYMENT_EXCEEDS_BALANCE', 'O pagamento excede o saldo do título.');
    await query(`INSERT INTO payable_payments
      (id, payable_id, kind, amount, effective_date, reference, created_at, actor_id, request_hash, correlation_id)
      VALUES ($1,$2,'payment',$3,$4,$5,$6,$7,$8,$9)`,
      [input.commandKey, input.payableId, input.amount, input.effectiveDate, input.reference,
        new Date().toISOString(), context.actorId, input.requestHash, context.correlationId]);
    await audit(query, context, 'payable', input.payableId, 'payment_registered', input.requestHash, { paymentId: input.commandKey, amount: input.amount, reference: input.reference });
    return { ok: true, replayed: false, resource: { type: 'payablePayment', id: input.commandKey, payableId: input.payableId, amount: String(input.amount), balance: String(balance - input.amount) } };
  });
}

export async function reversePayablePayment(context: RequestContext, input: { paymentId: string; commandKey: string; requestHash: string; effectiveDate: string; reference: string }) {
  return database().transaction(async query => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate)) throw new ApiError(400, 'VALIDATION_FAILED', 'A data do estorno é inválida.');
    const prior = await query('SELECT id, payable_id, amount, request_hash FROM payable_payments WHERE id=$1', [input.commandKey]);
    if (prior.rows.length) {
      const row = prior.rows[0];
      if (row.request_hash !== input.requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Chave utilizada em outra operação.');
      return { ok: true, replayed: true, resource: { type: 'payableReversal', id: row.id, payableId: row.payable_id, amount: String(row.amount) } };
    }
    const original = await query("SELECT id, payable_id, amount FROM payable_payments WHERE id=$1 AND kind='payment' FOR UPDATE", [input.paymentId]);
    if (!original.rows.length) throw new ApiError(404, 'NOT_FOUND', 'Pagamento não encontrado.');
    const row = original.rows[0];
    const alreadyReversed = await query('SELECT 1 FROM payable_payments WHERE reverses_id=$1', [input.paymentId]);
    if (alreadyReversed.rows.length) throw new ApiError(409, 'PAYMENT_ALREADY_REVERSED', 'Este pagamento já foi estornado.');
    await query(`INSERT INTO payable_payments
      (id, payable_id, kind, amount, effective_date, reference, reverses_id, created_at, actor_id, request_hash, correlation_id)
      VALUES ($1,$2,'reversal',$3,$4,$5,$6,$7,$8,$9,$10)`,
      [input.commandKey, row.payable_id, row.amount, input.effectiveDate, input.reference, input.paymentId,
        new Date().toISOString(), context.actorId, input.requestHash, context.correlationId]);
    await audit(query, context, 'payable', row.payable_id as string, 'payment_reversed', input.requestHash, { paymentId: input.paymentId, reversalId: input.commandKey, reference: input.reference });
    return { ok: true, replayed: false, resource: { type: 'payableReversal', id: input.commandKey, payableId: row.payable_id, amount: String(row.amount) } };
  });
}
