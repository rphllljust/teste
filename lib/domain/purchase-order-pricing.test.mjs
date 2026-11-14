import test from 'node:test';
import assert from 'node:assert/strict';
import { pricePurchaseOrder } from './purchase-order-pricing.ts';
import { calculateMaterialRequirement } from '../application/mrp.ts';

const order = (changes = {}) => ({
 id: 'order-1', supplierId: 'supplier-1', reference: 'MRP-TEST', expectedOn: '2026-11-20',
 freight: 0, additionalCosts: 0,
 lines: [{ id: 'line-1', itemId: 'material-1', quantity: 1500, unitPrice: 12345, discount: 0, tax: 0 }],
 ...changes,
});
test('purchase valuation preserves half-up rounding in scaled integers', () => {
 const priced = pricePurchaseOrder(order());
 assert.equal(priced.lines[0].subtotal, 18518);
 assert.equal(priced.total, 18518);
});
test('direct Procurement and MRP share one valuation for multiple lines and charges', () => {
 const priced = pricePurchaseOrder(order({
  freight: 2500, additionalCosts: 500,
  lines: [
   { id: 'a', itemId: 'a', quantity: 1000, unitPrice: 10000, discount: 1000, tax: 300 },
   { id: 'b', itemId: 'b', quantity: 2000, unitPrice: 9000, discount: 0, tax: 0 },
  ],
 }));
 assert.equal(priced.lines[0].subtotal, 9300);
 assert.equal(priced.lines[1].subtotal, 18000);
 assert.equal(priced.total, 30300);
});
test('invalid quantities, discounts and monetary overflows are rejected', () => {
 for (const quantity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  assert.throws(() => pricePurchaseOrder(order({ lines: [{ ...order().lines[0], quantity }] })));
 }
 assert.throws(() => pricePurchaseOrder(order({ freight: -1 })));
 assert.throws(() => pricePurchaseOrder(order({ lines: [{ ...order().lines[0], unitPrice: 0 }] })));
 assert.throws(() => pricePurchaseOrder(order({ lines: [{ ...order().lines[0], quantity: Number.MAX_SAFE_INTEGER, unitPrice: Number.MAX_SAFE_INTEGER }] })));
});
test('MRP shortage is replenished to target but planning does not change inventory', () => {
 const input = { physicalOnHand: 5000, reserved: 1000, eligibleIncoming: 2000, safetyStock: 10000 };
 const result = calculateMaterialRequirement(input);
 assert.equal(result.availableBeforeReplenishment, 4000);
 assert.equal(result.projectedBalanceBeforeReplenishment, 6000);
 assert.equal(result.netReplenishmentRequirement, 4000);
 assert.equal(result.projectedBalanceAfterReplenishment, 10000);
 assert.equal(input.physicalOnHand, 5000);
});
