import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url).pathname;
const read = (name) => fs.readFileSync(`${root}app/${name}`, 'utf8');

test('critical workspaces cancel obsolete list and detail requests', () => {
  for (const name of ['ContractsWorkspace.tsx', 'ProposalsWorkspace.tsx', 'FiscalWorkspace.tsx']) {
    const source = read(name);
    assert.match(source, /AbortController/);
    assert.match(source, /signal:\s*controller\.signal/);
    assert.match(source, /\.abort\(\)/);
  }
});

test('critical mutations guard duplicate submissions locally', () => {
  for (const name of ['ContractsWorkspace.tsx', 'ProposalsWorkspace.tsx', 'FiscalWorkspace.tsx', 'ProcurementWorkspace.tsx']) {
    const source = read(name);
    assert.match(source, /busy|mutationBusy|retry/);
    assert.match(source, /if\s*\([^)]*(busy|mutationBusy)[^)]*\)\s*return|retry\.current\?\.payload/);
  }
});

test('queries preserve server-side filter and pagination parameters', () => {
  for (const name of ['ContractsWorkspace.tsx', 'ProposalsWorkspace.tsx', 'FiscalWorkspace.tsx']) {
    const source = read(name);
    assert.match(source, /URLSearchParams/);
    assert.match(source, /page/);
  }
});

test('no domain workspace introduces a second API contract', () => {
  for (const name of ['ContractsWorkspace.tsx', 'ProposalsWorkspace.tsx', 'FiscalWorkspace.tsx', 'ProcurementWorkspace.tsx']) {
    const source = read(name);
    assert.doesNotMatch(source, /\/api\/enterprise-loading|\/api\/cancel-query/);
  }
});
