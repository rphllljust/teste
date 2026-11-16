const statusTransitions = {
  open: new Set(['partially_settled', 'settled', 'cancelled']),
  partially_settled: new Set(['partially_settled', 'settled', 'cancelled']),
  settled: new Set(['reversed']),
  cancelled: new Set(),
  reversed: new Set(),
};

export function buildInstallments({ totalCents, count, firstDueDate, intervalDays = 30 }) {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) throw new Error('INVALID_TOTAL');
  if (!Number.isInteger(count) || count < 1 || count > 120) throw new Error('INVALID_INSTALLMENT_COUNT');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDueDate)) throw new Error('INVALID_DUE_DATE');
  if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 366) throw new Error('INVALID_INTERVAL');
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, index) => {
    const due = new Date(`${firstDueDate}T00:00:00Z`);
    due.setUTCDate(due.getUTCDate() + intervalDays * index);
    return {
      number: index + 1,
      amountCents: base + (index < remainder ? 1 : 0),
      dueDate: due.toISOString().slice(0, 10),
      settledCents: 0,
      status: 'open',
    };
  });
}

export function registerSettlement({ installment, amountCents, occurredOn, commandKey }) {
  if (!installment || typeof installment !== 'object') throw new Error('INVALID_INSTALLMENT');
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error('INVALID_SETTLEMENT_AMOUNT');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) throw new Error('INVALID_SETTLEMENT_DATE');
  if (!commandKey || typeof commandKey !== 'string') throw new Error('INVALID_COMMAND_KEY');
  if (!['open', 'partially_settled'].includes(installment.status)) throw new Error('INVALID_INSTALLMENT_STATE');
  const balanceCents = installment.amountCents - installment.settledCents;
  if (amountCents > balanceCents) throw new Error('SETTLEMENT_EXCEEDS_BALANCE');
  const settledCents = installment.settledCents + amountCents;
  return {
    ...installment,
    settledCents,
    status: settledCents === installment.amountCents ? 'settled' : 'partially_settled',
    lastSettlement: { amountCents, occurredOn, commandKey },
  };
}

export function reverseSettlement({ installment, settlement, occurredOn, commandKey }) {
  if (!installment || !settlement) throw new Error('INVALID_REVERSAL');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) throw new Error('INVALID_REVERSAL_DATE');
  if (!commandKey || typeof commandKey !== 'string') throw new Error('INVALID_COMMAND_KEY');
  if (installment.status !== 'settled') throw new Error('ONLY_SETTLED_CAN_BE_REVERSED');
  if (settlement.amountCents > installment.settledCents) throw new Error('INVALID_REVERSAL_AMOUNT');
  return {
    ...installment,
    settledCents: installment.settledCents - settlement.amountCents,
    status: 'reversed',
    reversal: { amountCents: settlement.amountCents, occurredOn, commandKey },
  };
}

export function agingBucket({ dueDate, asOf }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error('INVALID_AGING_DATE');
  const days = Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86400000);
  if (days <= 0) return 'current';
  if (days <= 30) return '1_30';
  if (days <= 60) return '31_60';
  if (days <= 90) return '61_90';
  return 'over_90';
}

export function canTransition(from, to) {
  return Boolean(statusTransitions[from]?.has(to));
}
