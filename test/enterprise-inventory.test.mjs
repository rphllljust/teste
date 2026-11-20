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
