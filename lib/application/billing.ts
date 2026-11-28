import { database } from '../../db/raw';
import { ApiError, type RequestContext } from '../api/http';
import { assertFinancePeriodOpen, lockFinancePeriodScope } from './finance';

export type BillApprovedMeasurementInput = {
  measurementId: string;
  dueDate: string;
  commandKey: string;
  requestHash: string;
  expectedVersion?: number;
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

    // Hold the owner financial-scope lock before any business-row lock: this
    // serializes policy changes, period closes and concurrent invoice posting.
    await lockFinancePeriodScope(query, context.actorId);
    const postingRule = await query(
      "SELECT p.id,p.debit_account_id,p.credit_account_id,p.row_version, "+
      "d.active AS debit_active,d.type AS debit_type,d.actor_id AS debit_owner, "+
      "c.active AS credit_active,c.type AS credit_type,c.actor_id AS credit_owner "+
      "FROM accounting_posting_rules p "+
      "LEFT JOIN chart_accounts d ON d.id=p.debit_account_id "+
      "LEFT JOIN chart_accounts c ON c.id=p.credit_account_id "+
      "WHERE p.actor_id=$1 AND p.source_type='invoice_billing' AND p.active=1 FOR SHARE OF p",
      [context.actorId],
    );
    const rule = postingRule.rows[0];
    if (rule && (rule.debit_active !== 1 || rule.credit_active !== 1 ||
      rule.debit_type !== 'asset' || rule.credit_type !== 'revenue' ||
      rule.debit_owner !== context.actorId || rule.credit_owner !== context.actorId ||
      rule.debit_account_id === rule.credit_account_id)) {
      throw new ApiError(409, 'ACCOUNTING_RULE_INVALID',
        'Regra ativa inválida: revise contas contábeis antes de faturar.');
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
    // Concurrent retries can wait behind the financial-scope lock and then
    // observe a billed measurement with a newer version. Recover the committed
    // event BEFORE rejecting a stale expectedVersion, but never replay a
    // different request using the same key.
    if (measurement.status !== 'approved' ||
        (input.expectedVersion !== undefined && Number(measurement.version) !== input.expectedVersion)) {
      const committed = await query(
        'SELECT request_hash,result FROM order_events WHERE id=$1',
        [input.commandKey],
      );
      if (committed.rows.length) {
        if (committed.rows[0].request_hash !== input.requestHash || !committed.rows[0].result) {
          throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Chave de comando já utilizada.');
        }
        return { ...storedResult(committed.rows[0].result), replayed: true };
      }
    }
    if (input.expectedVersion !== undefined && Number(measurement.version) !== input.expectedVersion) {
      throw new ApiError(409, 'VERSION_CONFLICT', 'A medição mudou. Atualize o contexto.');
    }
    if (measurement.status !== 'approved') {
      throw new ApiError(409, 'INVALID_STATE', 'Somente uma medição aprovada pode gerar faturamento.');
    }

    const now = new Date().toISOString();
    const postingDate = now.slice(0, 10);
    // Billing itself is a financial operation; reject closed periods even
    // when auto-posting is disabled, preventing unposted backdated activity.
    await assertFinancePeriodOpen(query, context.actorId, postingDate);
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
        accounting: rule ? { status: 'auto_posted', ruleVersion: Number(rule.row_version) } :
          { status: 'not_enabled' },
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
    if (rule) {
      // The A/R and revenue journal, immutable origin link and audit are part
      // of the SAME transaction that creates the invoice and receivable.
      const amount = BigInt(String(measurement.amount));
      if (amount <= 0n || amount > 2147483647n)
        throw new ApiError(409, 'ACCOUNTING_AMOUNT_INVALID', 'Valor incompatível com o diário contábil.');
      const journalId = crypto.randomUUID();
      await query(
        "INSERT INTO journal_entries(id,effective_date,source_reference,description,status,expected_count,created_at,actor_id,request_hash,correlation_id) "+
        "VALUES($1,$2,$3,$4,'posted',2,$5,$6,$7,$8)",
        [journalId,postingDate,'invoice:'+invoiceId,'Reconhecimento automático de faturamento',now,
          context.actorId,input.requestHash,context.correlationId],
      );
      await query(
        'INSERT INTO journal_lines(id,entry_id,account_id,debit,credit) '+
        'VALUES($1,$2,$3,$4,0),($5,$2,$6,0,$4)',
        [crypto.randomUUID(),journalId,rule.debit_account_id,String(amount),crypto.randomUUID(),rule.credit_account_id],
      );
      await query(
        "INSERT INTO accounting_invoice_links(id,actor_id,invoice_id,journal_id,amount,posting_mode,rule_version,request_hash,correlation_id,created_at) "+
        "VALUES($1,$2,$3,$4,$5,'automatic_invoice',$6,$7,$8,$9)",
        [crypto.randomUUID(),context.actorId,invoiceId,journalId,String(amount),Number(rule.row_version),
          input.requestHash,context.correlationId,now],
      );
      await query(
        "INSERT INTO finance_audit_events(id,entity_type,entity_id,action,actor_id,request_hash,correlation_id,metadata,occurred_at) "+
        "VALUES($1,'invoice',$2,'invoice_auto_posted',$3,$4,$5,$6,$7)",
        [crypto.randomUUID(),invoiceId,context.actorId,input.requestHash,context.correlationId,
          JSON.stringify({journalId,amountScaled:String(amount),ruleVersion:Number(rule.row_version),
            postingDate,ruleId:String(rule.id),mode:'automatic_invoice'}),now],
      );
      (result.resource.accounting as Record<string, unknown>).journalId = journalId;
    }
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
