import { database } from '../../db/raw';
import { ApiError, type RequestContext } from '../api/http';

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
const audit = (query: Query, context: RequestContext, entityType: string, entityId: string, action: string, requestHash: string, metadata: Record<string, unknown>) => query(`INSERT INTO finance_audit_events (id,entity_type,entity_id,action,actor_id,request_hash,correlation_id,metadata,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [crypto.randomUUID(), entityType, entityId, action, context.actorId, requestHash, context.correlationId, JSON.stringify(metadata), new Date().toISOString()]);

type AccountingEventInput = {
  eventType: 'receivable_settlement' | 'receivable_reversal' | 'payable_payment' | 'payable_reversal';
  sourceReference: string;
  description: string;
  effectiveDate: string;
  amount: number;
};

export async function postConfiguredAccountingEvent(
  query: Query, context: RequestContext, input: AccountingEventInput,
): Promise<{posted: boolean; replayed?: boolean; journalId?: string; reason?: string}> {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0)
    throw new ApiError(400, 'VALIDATION_FAILED', 'O valor contábil deve ser positivo.');
  await assertFinancePeriodOpen(query, context.actorId, input.effectiveDate);
  const rule = await query(
    `SELECT debit_account_id, credit_account_id
       FROM accounting_event_rules
      WHERE actor_id=$1 AND event_type=$2 AND active=true
      FOR SHARE`,
    [context.actorId, input.eventType],
  );
  if (!rule.rows.length)
    return {posted: false, reason: 'ACCOUNTING_RULE_NOT_CONFIGURED'};

  const existing = await query(
    'SELECT id FROM journal_entries WHERE actor_id=$1 AND source_reference=$2 FOR UPDATE',
    [context.actorId, input.sourceReference],
  );
  if (existing.rows.length)
    return {posted: true, replayed: true, journalId: String(existing.rows[0].id)};

  const accounts = await query(
    `SELECT id FROM chart_accounts
      WHERE actor_id=$1 AND active=1 AND id = ANY($2::text[])`,
    [context.actorId, [rule.rows[0].debit_account_id, rule.rows[0].credit_account_id]],
  );
  if (accounts.rows.length !== 2)
    throw new ApiError(409, 'ACCOUNTING_RULE_INVALID', 'A regra contábil referencia contas indisponíveis.');

  const journalId = crypto.randomUUID();
  await query(
    `INSERT INTO journal_entries
      (id,effective_date,source_reference,description,status,expected_count,
       created_at,actor_id,request_hash,correlation_id,reversal_of)
      VALUES($1,$2,$3,$4,'posted',2,$5,$6,$7,$8,$9,NULL)`,
    [journalId, input.effectiveDate, input.sourceReference, input.description,
      new Date().toISOString(), context.actorId,
      await fingerprint({actorId: context.actorId, event: input}),
      context.correlationId],
  );
  await query(
    'INSERT INTO journal_lines(id,entry_id,account_id,debit,credit) VALUES($1,$2,$3,$4,0),($5,$2,$6,0,$7)',
    [crypto.randomUUID(), journalId, rule.rows[0].debit_account_id, input.amount,
      crypto.randomUUID(), rule.rows[0].credit_account_id, input.amount],
  );
  return {posted: true, replayed: false, journalId};
}
export async function assertFinancePeriodOpen(query: Query, actorId: string, effectiveDate: string) {
  const closed = await query("SELECT 1 FROM finance_period_closes WHERE actor_id=$1 AND status='closed' AND period_start<=$2 AND period_end>=$2 LIMIT 1", [actorId, effectiveDate]);
  if (closed.rows.length) throw new ApiError(409, 'FINANCE_PERIOD_CLOSED', 'O período financeiro está fechado para novos lançamentos.');
}

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
  await assertFinancePeriodOpen(query, context.actorId, input.effectiveDate);

  // Lock the owned title FIRST. A correlated SUM in the locking SELECT may
  // use the snapshot taken before a concurrent lock wait (READ COMMITTED),
  // allowing multiple requests to spend the same stale balance.
  const receivable = await query(`SELECT r.id, r.amount
    FROM receivables r
    JOIN invoices i ON i.id=r.invoice_id
    JOIN service_orders o ON o.id=i.order_id
    WHERE r.id=$1 AND o.owner_id=$2 FOR UPDATE OF r`, [input.receivableId, context.actorId]);
  if (!receivable.rows.length) throw new ApiError(404, 'NOT_FOUND', 'Título financeiro não encontrado.');
  // A concurrent retry can commit while this transaction waits for the title
  // lock. Re-read the command key in the new READ COMMITTED snapshot.
  const prior = await query('SELECT id, receivable_id, amount, effective_date, reference, request_hash FROM receivable_settlements WHERE id=$1 AND actor_id=$2', [input.commandKey, context.actorId]);
  if (prior.rows.length) {
    const row = prior.rows[0];
    if (row.request_hash !== input.requestHash || row.receivable_id !== input.receivableId) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Chave utilizada em outra operação.');
    return { ok: true, replayed: true, resource: { type: 'receivableSettlement', id: row.id, receivableId: row.receivable_id, amount: String(row.amount), effectiveDate: row.effective_date, reference: row.reference } };
  }

  // A new statement after the lock gets a NEW READ COMMITTED snapshot.
  const paid = await query(`SELECT COALESCE(SUM(
    CASE WHEN kind='receipt' THEN amount ELSE -amount END),0) AS settled
    FROM receivable_settlements WHERE receivable_id=$1`, [input.receivableId]);
  const row = receivable.rows[0];
  const balance = Number(row.amount) - Number(paid.rows[0]?.settled ?? 0);
  if (input.amount > balance) throw new ApiError(409, 'SETTLEMENT_EXCEEDS_BALANCE', 'A baixa excede o saldo do título.');

  await query(`INSERT INTO receivable_settlements
    (id, receivable_id, kind, amount, effective_date, reference, created_at, actor_id, request_hash, correlation_id)
    VALUES ($1,$2,'receipt',$3,$4,$5,$6,$7,$8,$9)`,
    [input.commandKey, input.receivableId, input.amount, input.effectiveDate, input.reference,
      new Date().toISOString(), context.actorId, input.requestHash, context.correlationId]);
  await audit(query, context, 'receivable', input.receivableId, 'receipt_registered', input.requestHash, { settlementId: input.commandKey, amount: input.amount, reference: input.reference });
  const accounting = await postConfiguredAccountingEvent(query, context, {
    eventType: 'receivable_settlement', sourceReference: `receivable_settlement:${input.commandKey}`,
    description: `Liquidação do recebível ${input.receivableId}`, effectiveDate: input.effectiveDate, amount: input.amount,
  });

  return { ok: true, replayed: false, resource: { type: 'receivableSettlement', id: input.commandKey, receivableId: input.receivableId, amount: String(input.amount), balance: String(balance - input.amount), accounting } };
}

export async function reverseReceivableSettlement(context: RequestContext, input: { settlementId: string; commandKey: string; requestHash: string; effectiveDate: string; reference: string }) {
  return database().transaction(async query => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate)) throw new ApiError(400, 'VALIDATION_FAILED', 'A data do estorno é inválida.');
    await assertFinancePeriodOpen(query, context.actorId, input.effectiveDate);
    const original = await query(`SELECT s.id, s.receivable_id, s.amount, r.id AS title_id
      FROM receivable_settlements s JOIN receivables r ON r.id=s.receivable_id
      JOIN invoices i ON i.id=r.invoice_id
      JOIN service_orders o ON o.id=i.order_id
      WHERE s.id=$1 AND s.kind='receipt' AND s.actor_id=$2 AND o.owner_id=$2
      FOR UPDATE OF s,r`, [input.settlementId, context.actorId]);
    if (!original.rows.length) throw new ApiError(404, 'NOT_FOUND', 'Baixa não encontrada.');
    // Both reversals lock the same original fact first; only then can we
    // decide whether the identical command was already committed.
    const prior = await query('SELECT id, receivable_id, amount, request_hash FROM receivable_settlements WHERE id=$1 AND actor_id=$2', [input.commandKey, context.actorId]);
    if (prior.rows.length) {
      const row = prior.rows[0];
      if (row.request_hash !== input.requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Chave utilizada em outra operação.');
      return { ok: true, replayed: true, resource: { type: 'receivableReversal', id: row.id, receivableId: row.receivable_id, amount: String(row.amount) } };
    }

    const row = original.rows[0];
    const alreadyReversed = await query("SELECT 1 FROM receivable_settlements WHERE reverses_id=$1", [input.settlementId]);
    if (alreadyReversed.rows.length) throw new ApiError(409, 'SETTLEMENT_ALREADY_REVERSED', 'Esta baixa já foi estornada.');
    await query(`INSERT INTO receivable_settlements
      (id, receivable_id, kind, amount, effective_date, reference, reverses_id, created_at, actor_id, request_hash, correlation_id)
      VALUES ($1,$2,'reversal',$3,$4,$5,$6,$7,$8,$9,$10)`,
      [input.commandKey, row.receivable_id, row.amount, input.effectiveDate, input.reference, input.settlementId,
        new Date().toISOString(), context.actorId, input.requestHash, context.correlationId]);
    await audit(query, context, 'receivable', row.receivable_id as string, 'receipt_reversed', input.requestHash, { settlementId: input.settlementId, reversalId: input.commandKey, reference: input.reference });
    const accounting = await postConfiguredAccountingEvent(query, context, {
      eventType: 'receivable_reversal', sourceReference: `receivable_reversal:${input.commandKey}`,
      description: `Estorno da liquidação ${input.settlementId}`, effectiveDate: input.effectiveDate, amount: Number(row.amount),
    });
    return { ok: true, replayed: false, resource: { type: 'receivableReversal', id: input.commandKey, receivableId: row.receivable_id, amount: String(row.amount), accounting } };
  });
}

export async function registerPayablePayment(context: RequestContext, input: { payableId: string; amount: number; effectiveDate: string; reference: string; commandKey: string; requestHash: string }) {
  return database().transaction(async query => {
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new ApiError(400, 'VALIDATION_FAILED', 'O valor do pagamento deve ser positivo.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate)) throw new ApiError(400, 'VALIDATION_FAILED', 'A data do pagamento é inválida.');
    await assertFinancePeriodOpen(query, context.actorId, input.effectiveDate);
    // Serialize all payments against this owned obligation before reading
    // settled amounts. The second statement cannot reuse a pre-lock snapshot.
    const payable = await query(`SELECT p.id, p.amount FROM payables p
      WHERE p.id=$1 AND p.actor_id=$2 FOR UPDATE OF p`, [input.payableId, context.actorId]);
    if (!payable.rows.length) throw new ApiError(404, 'NOT_FOUND', 'Título a pagar não encontrado.');
    // Re-read idempotency only after acquiring the owned payable row lock.
    const prior = await query('SELECT id, payable_id, amount, request_hash FROM payable_payments WHERE id=$1 AND actor_id=$2', [input.commandKey, context.actorId]);
    if (prior.rows.length) {
      const row = prior.rows[0];
      if (row.request_hash !== input.requestHash || row.payable_id !== input.payableId) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Chave utilizada em outra operação.');
      return { ok: true, replayed: true, resource: { type: 'payablePayment', id: row.id, payableId: row.payable_id, amount: String(row.amount) } };
    }

    const paid = await query(`SELECT COALESCE(SUM(
      CASE WHEN kind='payment' THEN amount ELSE -amount END),0) AS settled
      FROM payable_payments WHERE payable_id=$1`, [input.payableId]);
    const row = payable.rows[0];
    const balance = Number(row.amount) - Number(paid.rows[0]?.settled ?? 0);
    if (input.amount > balance) throw new ApiError(409, 'PAYMENT_EXCEEDS_BALANCE', 'O pagamento excede o saldo do título.');
    await query(`INSERT INTO payable_payments
      (id, payable_id, kind, amount, effective_date, reference, created_at, actor_id, request_hash, correlation_id)
      VALUES ($1,$2,'payment',$3,$4,$5,$6,$7,$8,$9)`,
      [input.commandKey, input.payableId, input.amount, input.effectiveDate, input.reference,
        new Date().toISOString(), context.actorId, input.requestHash, context.correlationId]);
    await audit(query, context, 'payable', input.payableId, 'payment_registered', input.requestHash, { paymentId: input.commandKey, amount: input.amount, reference: input.reference });
    const accounting = await postConfiguredAccountingEvent(query, context, {
      eventType: 'payable_payment', sourceReference: `payable_payment:${input.commandKey}`,
      description: `Pagamento do título a pagar ${input.payableId}`, effectiveDate: input.effectiveDate, amount: input.amount,
    });
    return { ok: true, replayed: false, resource: { type: 'payablePayment', id: input.commandKey, payableId: input.payableId, amount: String(input.amount), balance: String(balance - input.amount), accounting } };
  });
}

export async function reversePayablePayment(context: RequestContext, input: { paymentId: string; commandKey: string; requestHash: string; effectiveDate: string; reference: string }) {
  return database().transaction(async query => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate)) throw new ApiError(400, 'VALIDATION_FAILED', 'A data do estorno é inválida.');
    await assertFinancePeriodOpen(query, context.actorId, input.effectiveDate);
    const original = await query("SELECT id, payable_id, amount FROM payable_payments WHERE id=$1 AND kind='payment' AND actor_id=$2 FOR UPDATE", [input.paymentId, context.actorId]);
    if (!original.rows.length) throw new ApiError(404, 'NOT_FOUND', 'Pagamento não encontrado.');
    // The original payment lock serializes concurrent reversal retries.
    const prior = await query('SELECT id, payable_id, amount, request_hash FROM payable_payments WHERE id=$1 AND actor_id=$2', [input.commandKey, context.actorId]);
    if (prior.rows.length) {
      const row = prior.rows[0];
      if (row.request_hash !== input.requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Chave utilizada em outra operação.');
      return { ok: true, replayed: true, resource: { type: 'payableReversal', id: row.id, payableId: row.payable_id, amount: String(row.amount) } };
    }

    const row = original.rows[0];
    const alreadyReversed = await query('SELECT 1 FROM payable_payments WHERE reverses_id=$1', [input.paymentId]);
    if (alreadyReversed.rows.length) throw new ApiError(409, 'PAYMENT_ALREADY_REVERSED', 'Este pagamento já foi estornado.');
    await query(`INSERT INTO payable_payments
      (id, payable_id, kind, amount, effective_date, reference, reverses_id, created_at, actor_id, request_hash, correlation_id)
      VALUES ($1,$2,'reversal',$3,$4,$5,$6,$7,$8,$9,$10)`,
      [input.commandKey, row.payable_id, row.amount, input.effectiveDate, input.reference, input.paymentId,
        new Date().toISOString(), context.actorId, input.requestHash, context.correlationId]);
    await audit(query, context, 'payable', row.payable_id as string, 'payment_reversed', input.requestHash, { paymentId: input.paymentId, reversalId: input.commandKey, reference: input.reference });
    const accounting = await postConfiguredAccountingEvent(query, context, {
      eventType: 'payable_reversal', sourceReference: `payable_reversal:${input.commandKey}`,
      description: `Estorno do pagamento ${input.paymentId}`, effectiveDate: input.effectiveDate, amount: Number(row.amount),
    });
    return { ok: true, replayed: false, resource: { type: 'payableReversal', id: input.commandKey, payableId: row.payable_id, amount: String(row.amount), accounting } };
  });
}

export async function registerCashTransfer(context: RequestContext, input: { id: string; fromAccountReference: string; toAccountReference: string; amount: number; effectiveDate: string; reference: string; requestHash: string }) {
  return database().transaction(async query => {
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new ApiError(400, 'VALIDATION_FAILED', 'O valor da transferência deve ser positivo.');
    if (input.fromAccountReference === input.toAccountReference) throw new ApiError(400, 'VALIDATION_FAILED', 'As contas de origem e destino devem ser diferentes.');
    await assertFinancePeriodOpen(query, context.actorId, input.effectiveDate);
    const prior = await query('SELECT id,from_account_reference,to_account_reference,amount,request_hash,actor_id FROM cash_transfers WHERE id=$1', [input.id]);
    if (prior.rows.length) {
      const row = prior.rows[0];
      if (row.request_hash !== input.requestHash || row.actor_id !== context.actorId) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Identificador de transferência já utilizado.');
      return { ok: true, replayed: true, resource: { type: 'cashTransfer', id: row.id, amount: String(row.amount) } };
    }
    await query(`INSERT INTO cash_transfers (id,from_account_reference,to_account_reference,amount,effective_date,reference,status,actor_id,request_hash,correlation_id,created_at) VALUES ($1,$2,$3,$4,$5,$6,'posted',$7,$8,$9,$10)`, [input.id, input.fromAccountReference, input.toAccountReference, input.amount, input.effectiveDate, input.reference, context.actorId, input.requestHash, context.correlationId, new Date().toISOString()]);
    await audit(query, context, 'cash_transfer', input.id, 'transfer_registered', input.requestHash, { from: input.fromAccountReference, to: input.toAccountReference, amount: input.amount, reference: input.reference });
    return { ok: true, replayed: false, resource: { type: 'cashTransfer', id: input.id, amount: String(input.amount), from: input.fromAccountReference, to: input.toAccountReference } };
  });
}

export async function reverseCashTransfer(context: RequestContext, input: { transferId: string; commandKey: string; requestHash: string; reference: string }) {
  return database().transaction(async query => {
    const prior = await query('SELECT id,request_hash FROM finance_audit_events WHERE entity_type=$1 AND entity_id=$2 AND action=$3 AND request_hash=$4 AND actor_id=$5', ['cash_transfer_reversal', input.transferId, 'transfer_reversed', input.requestHash, context.actorId]);
    if (prior.rows.length) return { ok: true, replayed: true, resource: { type: 'cashTransferReversal', id: input.commandKey, transferId: input.transferId } };
    const transfer = await query("SELECT id,from_account_reference,to_account_reference,amount,status FROM cash_transfers WHERE id=$1 AND actor_id=$2 FOR UPDATE", [input.transferId, context.actorId]);
    if (!transfer.rows.length) throw new ApiError(404, 'NOT_FOUND', 'Transferência não encontrada.');
    const row = transfer.rows[0];
    if (row.status !== 'posted') throw new ApiError(409, 'TRANSFER_ALREADY_REVERSED', 'A transferência já foi estornada.');
    await query("UPDATE cash_transfers SET status='reversed' WHERE id=$1 AND actor_id=$2 AND status='posted'", [input.transferId, context.actorId]);
    await audit(query, context, 'cash_transfer_reversal', input.transferId, 'transfer_reversed', input.requestHash, { reversalId: input.commandKey, reference: input.reference, amount: row.amount });
    return { ok: true, replayed: false, resource: { type: 'cashTransferReversal', id: input.commandKey, transferId: input.transferId, amount: String(row.amount) } };
  });
}
