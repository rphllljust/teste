import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCashStressScenario} from './finance-cash-scenario.ts';

test('stress flow reschedules only receivables; payables and realized data are unchanged',()=>{
 const source=[
  {date:'2026-12-15',projectedIn:'125000',projectedOut:'0'},
  {date:'2026-12-20',projectedIn:'0',projectedOut:'175000'},
  {date:'2026-12-22',projectedIn:'0',projectedOut:'0'},
 ];
 const baseline=buildCashStressScenario(source,'2026-12-31',0);
 const stress=buildCashStressScenario(source,'2026-12-31',7);
 assert.equal(baseline.baselineNetScaled,'-50000');
 assert.equal(stress.stressedNetScaled,'-50000');
 assert.equal(stress.rows.find(x=>x.date==='2026-12-20').stressedRunningScaled,'-175000');
 assert.equal(stress.rows.find(x=>x.date==='2026-12-22').stressedRunningScaled,'-50000');
 assert.equal(stress.maximumTemporaryGapScaled,'125000');
 assert.equal(stress.delayedBeyondHorizonScaled,'0');
});
test('deferred receivables are exposed as outside horizon instead of silently counted',()=>{
 const r=buildCashStressScenario([{date:'2026-12-29',projectedIn:'90071992547410000',projectedOut:'3456'}],
  '2026-12-31',7);
 assert.equal(r.delayedBeyondHorizonScaled,'90071992547410000');
 assert.equal(r.stressedNetScaled,'-3456');
 assert.equal(r.baselineNetScaled,'90071992547406544');
 assert.equal(r.rows[0].deltaScaled,'-90071992547410000');
});
test('unsorted sparse dates are correctly ordered, with newly introduced due dates',()=>{
 const r=buildCashStressScenario([
  {date:'2027-02-10',projectedIn:'10000',projectedOut:'0'},
  {date:'2027-02-01',projectedIn:'30000',projectedOut:'1000'}
 ],'2027-02-28',7);
 assert.deepEqual(r.rows.map(x=>x.date),['2027-02-01','2027-02-08','2027-02-10','2027-02-17']);
 assert.equal(r.stressedNetScaled,r.baselineNetScaled);
});
test('rejects invalid amounts, invalid dates, negative obligation and unsupported scenario windows',()=>{
 assert.throws(()=>buildCashStressScenario([{date:'2026-11-20',projectedIn:'999.99',projectedOut:'0'}],'2026-11-30',0));
 assert.throws(()=>buildCashStressScenario([{date:'20/11/2026',projectedIn:'1',projectedOut:'0'}],'2026-11-30',0));
 assert.throws(()=>buildCashStressScenario([{date:'2026-11-20',projectedIn:'1',projectedOut:'-1'}],'2026-11-30',0));
 assert.throws(()=>buildCashStressScenario([], '2026-11-30',2));
});
