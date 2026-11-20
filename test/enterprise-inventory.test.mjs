import assert from 'node:assert/strict';
import test from 'node:test';
import { auditEnterpriseWorkspaces } from '../scripts/audit-enterprise-workspaces.mjs';

test('inventory enumerates the current source fleet and its navigation without static coverage inflation', async () => {
  const report = await auditEnterpriseWorkspaces();
  assert.ok(report.totalWorkspaceFiles >= 27);
  assert.ok(report.totalNavigationEntries >= 26);
  assert.deepEqual(report.unmountedFiles, []);
  assert.equal(report.totalMountedInRoot, report.totalWorkspaceFiles);
  assert.ok(report.workspaces.every(item => item.fluentRendered), 'a rendered Fluent control is required');
  assert.ok(report.workspaces.every(item => !item.browserHomologated && !item.stagingHomologated), 'code scan cannot attest production');
});


test('inventory is not counted as 27/27 business acceptance',async()=>{
 const report=await auditEnterpriseWorkspaces();
 assert.equal(report.totalWorkspaceFiles,27);
 assert.equal(report.totalNavigationEntries,26);
 assert.ok(report.workspaces.some(item=>item.entryPoint.accessMode==='contextual-command'));
 assert.ok(report.workspaces.some(item=>item.entryPoint.accessMode==='navigation-tab'));
 assert.ok(report.workspaces.every(item=>item.entryPoint.verified));
 assert.ok(report.workspaces.every(item=>item.acceptance==='NOT_TESTED'));
 assert.equal(report.verifiedAuthenticated,0);
 assert.equal(report.fullyHomologated,0);
});
