import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('app/components/enterprise/EnterprisePrimitives.tsx', 'utf8');
const css = fs.readFileSync('app/globals.css', 'utf8');

test('enterprise data state contract exposes all supported conditions', () => {
  for (const kind of ['error', 'blocked', 'manual', 'not_configured', 'unavailable']) {
    assert.match(source, new RegExp(`['"]${kind}['"]`));
    assert.match(css, new RegExp(`enterprise-data-state-${kind}`));
  }
});

test('enterprise states remain fail-closed and do not fabricate data', () => {
  assert.match(source, /classifyEnterpriseDataState/);
  assert.match(source, /OFBiz/);
  assert.match(source, /não transmitid/);
  assert.match(source, /enterprise-data-state/);
  assert.doesNotMatch(source, /mock|synthetic|fictitious/i);
});

test('existing ErrorState API remains compatible while accepting explicit kind', () => {
  assert.match(source, /ErrorState\(\{ message, onRetry, kind \}/);
  assert.match(source, /kind\?\:EnterpriseDataStateKind/);
});
