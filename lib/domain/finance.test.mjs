import test from 'node:test';
import assert from 'node:assert/strict';
import { agingBucket, buildInstallments, canTransition, registerSettlement, reverseSettlement } from './finance.mjs';

test('splits installments exactly, preserving cents', () => {
  const rows = buildInstallments({ totalCents: 10001, count: 3, firstDueDate: '2026-01-10' });
  assert.deepEqual(rows.map(row => row.amountCents), [3334, 3334, 3333]);
  assert.equal(rows.reduce((sum, row) => sum + row.amountCents, 0), 10001);
});

test('registers partial and final settlements without exceeding balance', () => {
  const installment = buildInstallments({ totalCents: 10000, count: 1, firstDueDate: '2026-01-10' })[0];
  const partial = registerSettlement({ installment, amountCents: 2500, occurredOn: '2026-01-12', commandKey: 'cmd-1' });
  assert.equal(partial.status, 'partially_settled');
  const settled = registerSettlement({ installment: partial, amountCents: 7500, occurredOn: '2026-01-20', commandKey: 'cmd-2' });
  assert.equal(settled.status, 'settled');
  assert.throws(() => registerSettlement({ installment: settled, amountCents: 1, occurredOn: '2026-01-21', commandKey: 'cmd-3' }), /INVALID_INSTALLMENT_STATE/);
});

test('reversal preserves an explicit reversal state', () => {
  const installment = { ...buildInstallments({ totalCents: 5000, count: 1, firstDueDate: '2026-01-10' })[0], settledCents: 5000, status: 'settled' };
  const reversed = reverseSettlement({ installment, settlement: { amountCents: 5000 }, occurredOn: '2026-02-01', commandKey: 'reverse-1' });
  assert.equal(reversed.status, 'reversed');
  assert.equal(reversed.settledCents, 0);
});

test('classifies aging and permits only explicit state transitions', () => {
  assert.equal(agingBucket({ dueDate: '2026-01-01', asOf: '2026-01-15' }), '1_30');
  assert.equal(agingBucket({ dueDate: '2026-01-01', asOf: '2026-05-01' }), 'over_90');
  assert.equal(canTransition('open', 'partially_settled'), true);
  assert.equal(canTransition('settled', 'open'), false);
});
