import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../app/AccountingWorkspace.tsx', import.meta.url), 'utf8');

test('posting rule selects remount only after both rule and account options are loaded', () => {
  assert.match(source, /ruleLoading\|\|loading\?/);
  assert.match(source, /key=\{`\$\{postingRule\?\.rowVersion\?\?0\}:\$\{accounts\.length\}`\}/);
  assert.match(source, /cashRuleLoading\|\|loading\?/);
  assert.match(source, /key=\{`\$\{cashRule\?\.rowVersion\?\?0\}:\$\{accounts\.length\}`\}/);
  assert.match(source, /payablePolicyLoading\|\|loading\?/);
  assert.match(source, /rule\?\.rowVersion\?\?0\)\+'-'\+accounts\.length/);
});
