import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const names = ['ClientsWorkspace', 'ProposalsWorkspace', 'ContractsWorkspace'];
const shared = await readFile(new URL('../app/components/enterprise/EnterpriseListReportFilters.tsx', import.meta.url), 'utf8');

test('commercial chain uses functional Fluent grids with API-backed filters and record commands', async () => {
  for (const name of names) {
    const source = await readFile(new URL('../app/' + name + '.tsx', import.meta.url), 'utf8');
    assert.match(source, /<EnterpriseDataGrid</, name);
    assert.match(source, /<EnterpriseListReportFilters/, name);
    assert.match(source, /getRowKey=\{\(item\) => item\.id\}/, name);
    assert.match(source, /onClick=\{\(\) => void open\(item\.id\)\}/, name);
    assert.match(source, /onValueChange=/, name);
    assert.match(source, /setPage\(1\)/, name);
  }
});
test('clear filter is a button, never a synthetic API request or automatic form submission', () => {
  assert.match(shared, /type="button"/);
  assert.match(shared, /onClick=\{onClear\}/);
  assert.doesNotMatch(shared, /<form\b/);
  assert.doesNotMatch(shared, /fetch\(/);
});
