import test from 'node:test';
import assert from 'node:assert/strict';
import {projectWorkPlan,nextWorkPackageState} from './service-order-workplan.mjs';
const pkg=(overrides={})=>({state:'draft',plannedCostScaled:'120000',plannedHoursScaled:'25000',overdue:false,blocked:false,...overrides});
test('rollup keeps exact money, excludes cancelled planned costs and does not invent zero-pct as complete',()=>{
 const report=projectWorkPlan([pkg({state:'done',plannedCostScaled:'99999999999999999'}),
  pkg({state:'cancelled',plannedCostScaled:'3333'}),pkg({blocked:true,overdue:true})],'30000');
 assert.equal(report.plannedCostScaled,'100000000000119999');
 assert.equal(report.varianceScaled,'100000000000089999');
 assert.equal(report.completionRatePercent,50);
 assert.equal(report.blocked,1);assert.equal(report.overdue,1);
 assert.equal(projectWorkPlan([],'0').completionRatePercent,null);
 assert.equal(projectWorkPlan([],'1234').unbudgeted,true);
});
test('dependency must be done, not just ready or in progress, before starting downstream work',()=>{
 const x={current:'ready',command:'start',orderState:'authorized',dependencyState:'in_progress'};
 assert.equal(nextWorkPackageState(x).code,'DEPENDENCY_UNFINISHED');
 assert.equal(nextWorkPackageState({...x,dependencyState:'done'}).state,'in_progress');
 assert.equal(nextWorkPackageState({...x,dependencyState:null,orderState:'draft'}).code,'ORDER_NOT_AUTHORIZED');
});
test('completion only while OS executing; terminal package cannot mutate',()=>{
 assert.equal(nextWorkPackageState({current:'in_progress',command:'complete',orderState:'authorized'}).code,'ORDER_NOT_EXECUTING');
 assert.equal(nextWorkPackageState({current:'in_progress',command:'complete',orderState:'executing'}).state,'done');
 assert.equal(nextWorkPackageState({current:'done',command:'cancel',orderState:'executing'}).code,'PACKAGE_TERMINAL');
 assert.equal(nextWorkPackageState({current:'ready',command:'cancel',orderState:'executing',hasActiveDependents:true}).code,'DEPENDENT_PACKAGES_OPEN');
});
test('reject precision-losing and invalid financial values',()=>{
 assert.throws(()=>projectWorkPlan([pkg({plannedCostScaled:'1.5'})],'0'),/INVALID_WORKPLAN_MONEY/);
 assert.throws(()=>projectWorkPlan([],'-1'),/INVALID_WORKPLAN_MONEY/);
});
