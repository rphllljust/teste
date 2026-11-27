import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyProcurePortfolio,sumScaled} from './procure-portfolio.mjs';

const record=(rest={})=>({
 status:'received',lineCount:1,orderedQuantity:'10000',acceptedQuantity:'10000',
 orderAmount:'123456789012345678901234',invoiceAmount:'100000',
 payableAmount:'100000',paidAmount:'0',attributedAmount:'0',
 hasInvoice:true,hasPayable:true,accrualVerified:false,unmatchedPayments:0,...rest
});
test('P2P documentary status never equates an open payable to a settled bank balance',()=>{
 const x=classifyProcurePortfolio(record());
 assert.equal(x.phase,'accounting');
 assert.equal(x.outstandingScaled,'100000');
 assert.ok(x.flags.includes('ACCOUNTING_UNVERIFIED'));
 assert.equal(x.orderScaled,'123456789012345678901234');
 assert.equal(x.receiptRatio,'10000');
});
test('receipt and supplier document gates are independent of accounting',()=>{
 assert.equal(classifyProcurePortfolio(record({acceptedQuantity:'5000'})).phase,'receiving');
 assert.equal(classifyProcurePortfolio(record({hasInvoice:false,hasPayable:false})).phase,'document');
 assert.equal(classifyProcurePortfolio(record({hasInvoice:true,hasPayable:false})).phase,'exception');
 assert.ok(classifyProcurePortfolio(record({invoiceAmount:'95000'})).flags.includes('DOCUMENT_AP_AMOUNT_MISMATCH'));
});
test('payment reversals and bank matches never manufacture an unsupported verified state',()=>{
 const settled=record({paidAmount:'100000',accrualVerified:true,unmatchedPayments:1});
 assert.equal(classifyProcurePortfolio(settled).phase,'bank');
 assert.equal(classifyProcurePortfolio({...settled,unmatchedPayments:0}).phase,'verified');
 const overpaid=classifyProcurePortfolio({...settled,paidAmount:'120000',unmatchedPayments:0});
 assert.ok(overpaid.flags.includes('PAYABLE_OVERSETTLED'));
 assert.equal(overpaid.phase,'exception');
 assert.equal(overpaid.outstandingScaled,'-20000');
});
test('cancelled and draft orders do not invent a posting requirement',()=>{
 for(const status of ['draft','cancelled']){
  const state=classifyProcurePortfolio(record({status,hasInvoice:false,hasPayable:false}));
  assert.equal(state.phase,status);
  assert.deepEqual(state.flags,[]);
 }
});
test('sums use precise signed BigInt for very large values',()=>{
 assert.equal(sumScaled(['999999999999999999999','1','-3']),'999999999999999999997');
 assert.throws(()=>sumScaled(['1.5']),/INVALID_PORTFOLIO_SCALED_VALUE/);
});
