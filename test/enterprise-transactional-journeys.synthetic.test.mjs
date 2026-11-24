import test from 'node:test';
import assert from 'node:assert/strict';

const syntheticJourneys = Object.freeze({
  financeToReceivable: Object.freeze({
    order: Object.freeze({ id: 'SYN-OS-001', status: 'completed', amount: 12500 }),
    measurement: Object.freeze({ id: 'SYN-MED-001', orderId: 'SYN-OS-001', status: 'approved', amount: 12500 }),
    invoice: Object.freeze({ id: 'SYN-INV-001', measurementId: 'SYN-MED-001', orderId: 'SYN-OS-001', amount: 12500 }),
    receivable: Object.freeze({ id: 'SYN-REC-001', invoiceId: 'SYN-INV-001', amount: 12500, status: 'open' }),
  }),
  procurementToReceipt: Object.freeze({
    requisition: Object.freeze({ id: 'SYN-REQ-001', status: 'approved', amount: 4200 }),
    purchaseOrder: Object.freeze({ id: 'SYN-PO-001', requisitionId: 'SYN-REQ-001', status: 'issued', amount: 4200 }),
    receipt: Object.freeze({ id: 'SYN-GRN-001', purchaseOrderId: 'SYN-PO-001', status: 'registered', amount: 4200 }),
  }),
});

function validateSyntheticJourneys(journeys) {
  const finance = journeys.financeToReceivable;
  const procurement = journeys.procurementToReceipt;
  const failures = [];
  if (finance.measurement.orderId !== finance.order.id) failures.push('measurement must reference its source order');
  if (finance.invoice.measurementId !== finance.measurement.id) failures.push('invoice must reference its source measurement');
  if (finance.invoice.orderId !== finance.order.id) failures.push('invoice must preserve the source order');
  if (finance.receivable.invoiceId !== finance.invoice.id) failures.push('receivable must reference its invoice');
  if (finance.measurement.status !== 'approved') failures.push('billing source must be approved');
  if (![finance.order.amount, finance.measurement.amount, finance.invoice.amount, finance.receivable.amount]
    .every((amount) => amount === finance.order.amount)) failures.push('finance amounts must remain consistent');
  if (procurement.purchaseOrder.requisitionId !== procurement.requisition.id) failures.push('purchase order must reference its requisition');
  if (procurement.receipt.purchaseOrderId !== procurement.purchaseOrder.id) failures.push('receipt must reference its purchase order');
  if (procurement.purchaseOrder.status !== 'issued') failures.push('receipt source must be an issued purchase order');
  if (procurement.purchaseOrder.amount !== procurement.receipt.amount) failures.push('procurement amounts must remain consistent');
  return { ok: failures.length === 0, failures };
}

test('synthetic finance journey preserves lineage from order to receivable', () => {
  const result = validateSyntheticJourneys(syntheticJourneys);
  assert.equal(result.ok, true, result.failures.join('; '));
  assert.equal(syntheticJourneys.financeToReceivable.receivable.status, 'open');
});

test('synthetic procurement journey preserves lineage from requisition to receipt', () => {
  const result = validateSyntheticJourneys(syntheticJourneys);
  assert.equal(result.ok, true, result.failures.join('; '));
  assert.equal(syntheticJourneys.procurementToReceipt.receipt.status, 'registered');
});

test('synthetic validator rejects broken cross-module lineage', () => {
  const broken = structuredClone(syntheticJourneys);
  broken.financeToReceivable.invoice.measurementId = 'SYN-MED-999';
  const result = validateSyntheticJourneys(broken);
  assert.equal(result.ok, false);
  assert.match(result.failures.join('; '), /invoice must reference its source measurement/);
});
