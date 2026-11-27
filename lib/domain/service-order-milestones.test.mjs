import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedMilestoneCodes,milestoneDescriptors,summarizeMilestoneEvents} from './service-order-milestones.mjs';
test('status governs only documentary milestones, not OS lifecycle transitions',()=>{
 assert.equal(milestoneDescriptors.length,6);
 assert.deepEqual(allowedMilestoneCodes('cancelled'),[]);
 assert.deepEqual(allowedMilestoneCodes('draft'),[]);
 assert.deepEqual(allowedMilestoneCodes('completed'),['quality_checked','handover_recorded']);
 assert.ok(allowedMilestoneCodes('executing').includes('execution_inspected'));
 assert.ok(!allowedMilestoneCodes('executing').includes('handover_recorded'));
});
test('append-only ledger replay derives active evidence and preserves historical reversals',()=>{
 const events=[
  {id:'c',sequence:3,kind:'record',checkpoint:'quality_checked'},
  {id:'b',sequence:2,kind:'revoke',checkpoint:'site_readiness',reversesId:'a'},
  {id:'a',sequence:1,kind:'record',checkpoint:'site_readiness'},
  {id:'d',sequence:4,kind:'record',checkpoint:'site_readiness'},
 ];
 const state=summarizeMilestoneEvents(events);
 assert.equal(state.find(v=>v.code==='quality_checked')?.active,true);
 assert.equal(state.find(v=>v.code==='site_readiness')?.currentId,'d');
 assert.equal(state.filter(v=>v.active).length,2);
});
test('reversing a stale event never revokes a later re-registration',()=>{
 const state=summarizeMilestoneEvents([
  {id:'a',sequence:1,kind:'record',checkpoint:'site_readiness'},
  {id:'b',sequence:2,kind:'record',checkpoint:'site_readiness'},
  {id:'c',sequence:3,kind:'revoke',checkpoint:'site_readiness',reversesId:'a'}
 ]);
 assert.equal(state.find(v=>v.code==='site_readiness')?.currentId,'b');
});
