import test from 'node:test';
import assert from 'node:assert/strict';
import {assessPaymentRunReadiness} from './payment-run-readiness.mjs';
const item=(o={})=>({amountScaled:'9007199254740993',baselineOutstandingScaled:'9007199254741000',
 currentOutstandingScaled:'9007199254741000',paymentId:null,...o});
test('preflight keeps exact BigInt amounts and is advisory without bank or accounting policy',()=>{
 const x=assessPaymentRunReadiness({run:{status:'prepared'},items:[item()],periodClosed:false,
  rule:{enabled:false,valid:false},originReady:null});
 assert.equal(x.canExecute,true);
 assert.equal(x.summary.totalScaled,'9007199254740993');
 assert.equal(x.summary.accountingPosting,'not_enabled');
 assert.ok(x.warnings.some(s=>s.includes('diário automático')));
});
test('transactional risks are individually classified without hidden exception',()=>{
 const x=assessPaymentRunReadiness({run:{status:'prepared'},items:[item({currentOutstandingScaled:'2',paymentId:'collision'}),item({currentOutstandingScaled:null})],
  periodClosed:true,rule:{enabled:true,valid:true},originReady:{missingCount:1}});
 assert.equal(x.canExecute,false);
 assert.deepEqual(x.blockers.map(x=>x.code),['FINANCE_PERIOD_CLOSED','PAYABLE_MISSING','PAYMENT_RUN_STALE','PAYMENT_RUN_COLLISION','PAYABLE_ORIGIN_UNRECOGNIZED']);
});
test('invalid posting rule blocks operations and posted run never previews as executable',()=>{
 const x=assessPaymentRunReadiness({run:{status:'posted'},items:[item()],periodClosed:false,
  rule:{enabled:true,valid:false},originReady:{missingCount:0}});
 assert.equal(x.canExecute,false);
 assert.ok(x.blockers.some(b=>b.code==='ACCOUNTING_RULE_INVALID'));
 assert.ok(x.blockers.some(b=>b.code==='RUN_NOT_PREPARED'));
});
