import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDailyFinancialFlow} from '../lib/domain/finance-cashflow.mjs';
test('cash uses exact integers beyond double precision and preserves BRL 4 decimals',()=>{
 const amount='900719925474099312345678';
 const result=buildDailyFinancialFlow({
  receivables:[{date:'2027-01-20',amount}],payables:[{date:'2027-01-20',amount:'2'}],
  receipts:[{date:'2027-01-20',amount:'50001'},{date:'2027-01-20',amount:'-20001'}],
  payments:[{date:'2027-01-20',amount:'5000'},{date:'2027-01-20',amount:'-2000'}],
 });
 assert.equal(result.items[0].projectedIn,amount);
 assert.equal(result.items[0].netProjected,(BigInt(amount)-2n).toString());
 assert.equal(result.summary.realizedIn,'30000');
 assert.equal(result.summary.realizedOut,'3000');
 assert.equal(result.items[0].netRealized,'27000');
});
test('reversal-only days remain signed instead of incorrectly increasing cash realization',()=>{
 const result=buildDailyFinancialFlow({receivables:[],payables:[],
  receipts:[{date:'2027-01-21',amount:'-10000'}],payments:[{date:'2027-01-21',amount:'-2000'}]});
 assert.equal(result.items[0].netRealized,'-8000');
 assert.equal(result.summary.realizedIn,'-10000');
 assert.throws(()=>buildDailyFinancialFlow({receivables:[{date:'invalid',amount:'3'}],payables:[],receipts:[],payments:[]}));
});
