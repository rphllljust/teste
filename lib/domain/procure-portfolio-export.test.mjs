import test from 'node:test';
import assert from 'node:assert/strict';
import {serializeProcurePortfolioCsv} from './procure-portfolio-export.mjs';
test('CSV keeps exact scaled strings and treats malicious spreadsheet expressions as inert text',()=>{
 const csv=serializeProcurePortfolioCsv([{
  reference:'=SUM(1,1)',supplier:'+HYPERLINK("example")',status:'received',phase:'payment',
  orderScaled:'999999999999999999999',payableScaled:'1',paidScaled:'0',
  outstandingScaled:'-5',attributedScaled:'0',expectedOn:'2026-11-27',
  payableDueOn:'2026-11-28',severity:'today',flags:['ACCOUNTING_UNVERIFIED'],
  alerts:['PAYMENT_DUE_SOON']
 }]);
 assert.ok(csv.startsWith('\uFEFF'));
 assert.ok(csv.includes('"\'=SUM(1,1)"'));
 assert.ok(csv.includes('"\'+HYPERLINK(""example"")"'));
 assert.ok(csv.includes('"\'-5"'));
 assert.ok(csv.includes('999999999999999999999'));
 assert.ok(csv.endsWith('\r\n'));
});
test('empty filtered pages retain CSV header',()=>{
 const csv=serializeProcurePortfolioCsv([]);
 assert.equal(csv.split('\r\n').filter(Boolean).length,1);
});
