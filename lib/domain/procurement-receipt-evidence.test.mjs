import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyProcurementReceiptEvidence as verify} from './procurement-receipt-evidence.mjs';
const line=(id,ordered,received,rejected,stock,movements=1)=>({
 id,quantity:ordered,receivedQuantity:received,rejectedQuantity:rejected,
 stockQuantity:stock,movementCount:movements
});
const check=(lines,total, movements=lines.length,receipts=1)=>verify(lines,{
 receiptCount:receipts,linkedQuantity:total,linkedMovements:movements,
});
test('complete two-line receipts require exact physical stock movements for each item',()=>{
 const r=check([line('alpha','3000','3000','0','3000'),
  line('beta','2000','2000','0','2000')],'5000');
 assert.equal(r.reconciled,true);
 assert.equal(r.lineEvidence.length,2);
 assert.equal(r.totals.acceptedQuantity,'5000');
});
test('offsetting inventory deviations cannot conceal a false aggregate reconciliation',()=>{
 const r=check([line('alpha','3000','3000','0','2000'),
  line('beta','2000','2000','0','3000')],'5000');
 assert.equal(r.reconciled,false);
 assert.equal(r.issues.filter(x=>x.code==='STOCK_LINE_MISMATCH').length,2);
});
test('rejected, missing, or excessive quantities never prove receipt completion',()=>{
 assert.ok(check([line('alpha','2000','1000','1000','1000')],'1000').issues.some(x=>x.code==='REJECTED_QUANTITY'));
 assert.ok(check([line('alpha','2000','1000','0','1000')],'1000').issues.some(x=>x.code==='RECEIPT_INCOMPLETE'));
 assert.ok(check([line('alpha','2000','2500','0','2500')],'2500').issues.some(x=>x.code==='RECEIPT_OVER_ORDERED'));
});
test('orphan movement counts and aggregates are independently checked',()=>{
 const r=check([line('alpha','3000','3000','0','3000')],'3000',2);
 assert.equal(r.reconciled,false);
 assert.ok(r.issues.some(x=>x.code==='UNATTRIBUTED_STOCK_MOVEMENTS'));
});
test('receipt and movement existence are mandatory evidence',()=>{
 const r=check([line('alpha','1000','0','0','0',0)],'0',0,0);
 assert.equal(r.reconciled,false);
 assert.ok(r.issues.some(x=>x.code==='NO_RECEIPTS'));
 assert.ok(r.issues.some(x=>x.code==='NO_STOCK_MOVEMENTS'));
});
test('scaled units use exact bigint strings, never unsafe floating point',()=>{
 const quantity='9007199254740993';
 const r=check([line('alpha',quantity,quantity,'0',quantity)],quantity,1,1);
 assert.equal(r.reconciled,true);
 assert.equal(r.totals.acceptedQuantity,quantity);
 assert.throws(()=>check([line('alpha',1000,Number.MAX_SAFE_INTEGER+2,'0','1')],'1'),/INVALID_PROCUREMENT_QUANTITY/);
});
