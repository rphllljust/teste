import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyProcureToPay,buildProcureToPayTotals} from './procure-to-pay-status.mjs';
test('procure-to-pay maintains exact scaled monetary facts and reversals',()=>{
 const totals=buildProcureToPayTotals({orderAmount:'900719925474099301',
 invoiceAmount:'900719925474099301',payableAmount:'900719925474099301',
 payments:[{kind:'payment',amountScaled:'900719925474099300'},{kind:'reversal',amountScaled:'200'}],
 allocated:'5000000000000'});
 assert.equal(totals.outstandingScaled,'201');
 assert.equal(totals.paidScaled,'900719925474099100');
 assert.equal(totals.unattributedCostScaled,'900714925474099301');
 assert.throws(()=>buildProcureToPayTotals({orderAmount:'1.50',payments:[]}));
});
test('classifies only verified exceptions and never invents GL or bank evidence',()=>{
 const base={lineCount:1,unreceivedCount:0,inventoryMismatchCount:0,orderStatus:'received',
 hasInvoice:true,hasPayable:true,invoiceAmount:'100',payableAmount:'100',
 accrualVerified:true,paymentCount:0,unpostedPaymentCount:0,unmatchedPaymentCount:0,outstandingScaled:'100'};
 assert.deepEqual(classifyProcureToPay(base),[]);
 const alerts=classifyProcureToPay({...base,inventoryMismatchCount:1,accrualVerified:false,
  unpostedPaymentCount:1,unmatchedPaymentCount:1,paymentCount:2,invoiceAmount:'99'});
 assert.deepEqual(alerts.map(x=>x.code),['INVENTORY_EVIDENCE_MISMATCH','THREE_WAY_VALUE_MISMATCH',
  'AP_ACCRUAL_UNVERIFIED','AP_PAYMENT_POSTING_UNVERIFIED','BANK_RECONCILIATION_PENDING']);
 assert.ok(classifyProcureToPay({...base,hasInvoice:false,hasPayable:false})
  .some(x=>x.code==='SUPPLIER_DOCUMENT_PENDING'));
 assert.throws(()=>classifyProcureToPay({...base,lineCount:-1}));
});
