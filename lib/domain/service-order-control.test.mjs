import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveServiceOrderControl} from './service-order-control.mjs';

const record=(overrides={})=>({
 status:'completed',dueDate:'2026-11-01',
 activeAllocations:0,activeExecutions:2,unmeasuredExecutions:1,
 measurements:2,measurementSubmitted:1,approvedUnbilled:1,
 invoices:2,invoicesWithoutReceivable:1,invoicedWithoutPosting:1,
 unmatchedReceipts:1,billedScaled:'300000',settledScaled:'100000',costScaled:'42000',
 ...overrides
});
const assess=(values={})=>deriveServiceOrderControl(record(values),{asOf:'2026-11-27'});
test('completed OS generates deterministic cross-module gaps with exact nominal values',()=>{
 const a=assess();
 const codes=a.alerts.map(v=>v.code);
 for(const key of ['EXECUTION_UNMEASURED','MEASUREMENT_PENDING_REVIEW','APPROVED_UNBILLED',
  'INVOICE_WITHOUT_RECEIVABLE','INVOICE_POSTING_UNVERIFIED','RECEIPT_BANK_MATCH_UNVERIFIED'])
  assert.ok(codes.includes(key),key);
 assert.equal(a.financial.openReceivableScaled,'200000');
 assert.equal(a.financial.partialContributionScaled,'258000');
 assert.equal(a.focus,'Medições');
});
test('executing order has separate allocation and reporting signals without false authorization',()=>{
 const a=assess({status:'executing',activeExecutions:0,activeAllocations:0,
  measurements:0,measurementSubmitted:0,approvedUnbilled:0,
  invoices:0,invoicesWithoutReceivable:0,invoicedWithoutPosting:0,
  unmatchedReceipts:0,billedScaled:'0',settledScaled:'0'});
 assert.ok(a.alerts.some(v=>v.code==='RESOURCE_PLAN_UNVERIFIED'));
 assert.ok(a.alerts.some(v=>v.code==='EXECUTION_NOT_REPORTED'));
 assert.equal(a.focus,'Execução');
});
test('completed OS without active report warns, but a clean OS does not invent missing links',()=>{
 const result=assess({activeExecutions:0,unmeasuredExecutions:0,measurements:0,
  measurementSubmitted:0,approvedUnbilled:0,invoices:0,
  invoicesWithoutReceivable:0,invoicedWithoutPosting:0,unmatchedReceipts:0,
  billedScaled:'0',settledScaled:'0',costScaled:'0'});
 assert.deepEqual(result.alerts.map(v=>v.code),['COMPLETED_WITHOUT_EXECUTION']);
});
test('reversals/overcollection and huge ledger values keep BigInt precision',()=>{
 const a=assess({billedScaled:'999999999999999999999999',
  settledScaled:'1000000000000000000000000',costScaled:'-9',
  activeExecutions:0,unmeasuredExecutions:0,approvedUnbilled:0,
  invoicesWithoutReceivable:0,invoicedWithoutPosting:0,measurementSubmitted:0,
  unmatchedReceipts:0});
 assert.equal(a.financial.openReceivableScaled,'-1');
 assert.equal(a.financial.partialContributionScaled,'1000000000000000000000008');
 assert.ok(a.alerts.some(v=>v.code==='RECEIPTS_EXCEED_INVOICES'));
 assert.ok(a.alerts.some(v=>v.code==='NEGATIVE_ALLOCATED_COST'));
});
test('cancelled order retains historical evidence without fictitious overdue',()=>{
 const a=assess({status:'cancelled',dueDate:'2026-01-02'});
 assert.equal(a.overdue,false);
 assert.ok(a.alerts.some(v=>v.code==='CANCELLED_WITH_EVIDENCE'));
 assert.ok(!a.alerts.some(v=>v.code==='ORDER_OVERDUE'));
});
test('invalid financial and time signals fail closed, no floating-point conversion',()=>{
 assert.throws(()=>assess({costScaled:'1.5'}),/INVALID_SERVICE_ORDER_SCALED_VALUE/);
 assert.throws(()=>assess({activeExecutions:-1}),/INVALID_SERVICE_ORDER_COUNT/);
 assert.throws(()=>deriveServiceOrderControl(record(),{asOf:'2026-02-30'}),/INVALID_SERVICE_ORDER_ASOF_DATE/);
});
