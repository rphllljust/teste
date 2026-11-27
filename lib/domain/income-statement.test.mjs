import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleIncomeStatement,incomeStatementBoundaries} from './income-statement.mjs';
test('income statement month boundaries cover year transition and leap February',()=>{
 assert.deepEqual(incomeStatementBoundaries('2026-01'),{periodMonth:'2026-01',priorMonth:'2025-12',from:'2026-01-01',toExclusive:'2026-02-01',priorFrom:'2025-12-01'});
 assert.deepEqual(incomeStatementBoundaries('2028-02'),{periodMonth:'2028-02',priorMonth:'2028-01',from:'2028-02-01',toExclusive:'2028-03-01',priorFrom:'2028-01-01'});
 for(const month of ['2026-00','2026-13','2026-1','bad','1899-12'])assert.throws(()=>incomeStatementBoundaries(month));
});
test('revenue and expense have opposite normal directions, including large and reversed postings',()=>{
 const r=assembleIncomeStatement([
  {id:'rev',code:'4',name:'Receita',type:'revenue',currentScaled:'9007199254741124',priorScaled:'1200000',currentLineCount:2,priorLineCount:1},
  {id:'exp',code:'5',name:'Despesa',type:'expense',currentScaled:'1000000',priorScaled:'2500000',currentLineCount:2,priorLineCount:1},
  {id:'rev-reversal',code:'4.2',name:'Estorno',type:'revenue',currentScaled:'-40000',priorScaled:'0',currentLineCount:1,priorLineCount:0}
 ],'2026-11','2026-10');
 assert.equal(r.totals.revenueScaled,'9007199254701124');
 assert.equal(r.totals.expenseScaled,'1000000');
 assert.equal(r.totals.netScaled,'9007199253701124');
 assert.equal(r.totals.priorNetScaled,'-1300000');
 assert.equal(r.totals.netChangeScaled,'9007199255001124');
 assert.equal(r.totals.currentLineCount,5);
 assert.equal(r.emptyState,null);
});
test('does not claim income where there is no classified account or posted transaction',()=>{
 assert.equal(assembleIncomeStatement([],'2026-11','2026-10').emptyState,'no_classified_accounts');
 assert.equal(assembleIncomeStatement([{id:'a',code:'5',name:'Expense',type:'expense',currentScaled:'0',priorScaled:'0',currentLineCount:0,priorLineCount:0}],'2026-11','2026-10').emptyState,'no_postings');
 assert.throws(()=>assembleIncomeStatement([{id:'a',type:'asset'}],'2026-11','2026-10'));
 assert.throws(()=>assembleIncomeStatement([{id:'a',type:'revenue',currentScaled:'0.10'}],'2026-11','2026-10'));
});
