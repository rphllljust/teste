import test from 'node:test';
import assert from 'node:assert/strict';
import {assessProcureDeadlines} from './procure-deadlines.mjs';
const reference={status:'approved',orderedQuantity:'20000',acceptedQuantity:'0',
 expectedOn:'2026-11-20',payableDueOn:'2026-11-26',hasPayable:true,outstandingScaled:'120000'};
const assess=(overrides={})=>assessProcureDeadlines({...reference,...overrides},{today:'2026-11-27'});
test('independent delivery and payment overdue dates use exact UTC calendar days',()=>{
 const result=assess();
 assert.deepEqual(result.alerts,['DELIVERY_OVERDUE','PAYMENT_OVERDUE']);
 assert.equal(result.delivery.daysUntil,-7);
 assert.equal(result.payment.daysUntil,-1);
 assert.equal(result.severity,'overdue');
});
test('fully received purchase does not manufacture delivery delay and paid title has no maturity alert',()=>{
 const done=assess({acceptedQuantity:'20000',outstandingScaled:'0'});
 assert.equal(done.delivery.state,'not_applicable');
 assert.equal(done.payment.state,'not_applicable');
 assert.deepEqual(done.alerts,[]);
});
test('draft and cancelled orders never appear as operational overdue',()=>{
 for(const status of ['draft','cancelled'])assert.deepEqual(assess({status}).alerts,[]);
});
test('unlinked payable, missing dates and huge currency do not invent due dates or lose precision',()=>{
 const row=assess({hasPayable:false,expectedOn:null,outstandingScaled:'99999999999999999999'});
 assert.equal(row.payment.state,'not_applicable');
 assert.equal(row.delivery.state,'unknown');
 assert.deepEqual(row.alerts,[]);
});
test('today, coming week and later dates have deterministic non-overdue categories',()=>{
 assert.deepEqual(assess({expectedOn:'2026-11-27',payableDueOn:'2026-12-03'}).alerts,
 ['DELIVERY_DUE_TODAY','PAYMENT_DUE_SOON']);
 assert.equal(assess({expectedOn:'2026-12-12',payableDueOn:'2026-12-13'}).severity,'none');
 assert.throws(()=>assessProcureDeadlines(reference,{today:'2026-02-30'}),/INVALID_PROCURE_REFERENCE_DATE/);
});
