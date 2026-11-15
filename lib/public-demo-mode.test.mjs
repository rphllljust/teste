import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicDemoModeEnabled } from './public-demo-mode.mjs';

test('public demo requires both an exact staging environment and explicit server flag', () => {
  assert.equal(isPublicDemoModeEnabled('staging', 'true'), true);
  assert.equal(isPublicDemoModeEnabled('production', 'true'), false);
  assert.equal(isPublicDemoModeEnabled('staging', 'false'), false);
  assert.equal(isPublicDemoModeEnabled(undefined, 'true'), false);
  assert.equal(isPublicDemoModeEnabled('STAGING', 'true'), false);
});
