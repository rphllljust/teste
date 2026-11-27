import test from 'node:test';
import assert from 'node:assert/strict';
import {assessServiceOrderControl} from './service-order-control.mjs';
const base={
 order:{status:'completed',dueDate:'2026-11-18'},
 evidence:{activeExecution:3,correctedExecution:1,allocations:2,measurements:1,
  unmeasuredExecution:2,pendingMeasurements:1,approvedUnbilled:0,invoices:1},
 amounts:{billedScaled:'999999999999999999999',receivedScaled:'900000000000000000000',
  attributedCostScaled:'23000000000000000000'}
};
const evaluate=(o={},e={},m={})=>assessServiceOrderControl({...base.order,...o},
 {...base.evidence,...e},{...base.amounts,...m},{asOf:'2026-11-27'});
test('uses BigInt, preserves scaled amounts far above Number.MAX_SAFE_INTEGER and returns partial contribution',()=>{
 const state=evaluate();
 assert.equal(state.financial.billedScaled,'999999999999999999999');
 assert.equal(state.financial.receivableOutstandingScaled,'99999999999999999999');
 assert.equal(state.financial.partialContributionScaled,'976999999999999999999');
 assert.equal(state.phase,'measurement');
 assert.ok(state.flags.includes('EXECUTION_WITHOUT_MEASUREMENT'));
 assert.ok(state.flags.includes('MEASUREMENT_DECISION_PENDING'));
 assert.ok(state.flags.includes('RECEIVABLE_BALANCE_OPEN'));
 assert.equal(state.overdue,false);
});
test('overdue only on active OS, never completed or cancelled',()=>{
 assert.ok(evaluate({status:'executing'},{allocations:0}).flags.includes('OS_DEADLINE_OVERDUE'));
 assert.ok(evaluate({status:'executing'},{allocations:0}).flags.includes('RESOURCE_ALLOCATION_NOT_RECORDED'));
 assert.equal(evaluate({status:'completed'}).overdue,false);
 assert.deepEqual(evaluate({status:'cancelled'}).flags.filter(f=>f==='OS_DEADLINE_OVERDUE'),[]);
});
test('over-receipt is exception and never reported as a fully reconciled bank balance',()=>{
 const v=evaluate({}, {unmeasuredExecution:0,pendingMeasurements:0,approvedUnbilled:0},
  {billedScaled:'100000',receivedScaled:'120000',attributedCostScaled:'1'});
 assert.equal(v.financial.receivableOutstandingScaled,'-20000');
 assert.ok(v.flags.includes('RECEIPTS_EXCEED_INVOICES'));
 assert.equal(v.severity,'high');
});
test('distinct measurement approval and billing stages use evidence, not order status alone',()=>{
 assert.equal(evaluate({status:'completed'},{unmeasuredExecution:0,pendingMeasurements:1}).phase,'approval');
 assert.equal(evaluate({status:'completed'},{unmeasuredExecution:0,pendingMeasurements:0,approvedUnbilled:1}).phase,'billing');
 assert.equal(evaluate({status:'completed'},{unmeasuredExecution:0,pendingMeasurements:0,approvedUnbilled:0},
  {receivedScaled:'999999999999999999999'}).phase,'invoiced');
});
test('malformed accounting numbers and impossible calendar dates are rejected',()=>{
 assert.throws(()=>evaluate({}, {},{billedScaled:'1.5'}),/INVALID_OS_CONTROL_MONEY/);
 assert.throws(()=>evaluate({}, {allocations:-1}),/INVALID_OS_CONTROL_COUNT/);
 assert.throws(()=>assessServiceOrderControl(base.order,base.evidence,base.amounts,{asOf:'2026-02-30'}),/INVALID_OS_CONTROL_REFERENCE_DATE/);
});
