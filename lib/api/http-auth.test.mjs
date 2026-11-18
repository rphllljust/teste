import test from 'node:test';
import assert from 'node:assert/strict';
import { stagingBoundaryError } from './staging-access.mjs';

test('staging public workspace denies a forged browser identity', () => {
  const result = stagingBoundaryError(new Request('https://staging.example/api/orders', {
    headers: { 'oai-authenticated-user-id': 'forged-admin' },
  }), { RAILWAY_ENVIRONMENT_NAME: 'staging', CISNE_STAGING_ACCESS_MODE: 'public' });
  assert.equal(result?.status, 403);
  assert.equal(result?.code, 'STAGING_PRIVATE_ACCESS_REQUIRED');
});

test('staging rejects all client-supplied dispatch secrets and identity headers', () => {
  const env = { RAILWAY_ENVIRONMENT_NAME: 'staging', CISNE_STAGING_ACCESS_MODE: 'private', CISNE_TRUSTED_DISPATCH_SECRET: 'server-secret' };
  for (const headers of [
    { 'oai-authenticated-user-id': 'forged-admin' },
    { 'x-cisne-dispatch-secret': 'server-secret', 'oai-authenticated-user-id': 'forged-admin' },
  ]) {
    const result = stagingBoundaryError(new Request('https://staging.example/api/orders', { headers }), env);
    assert.equal(result?.status, 403);
    assert.equal(result?.code, 'STAGING_PRIVATE_ACCESS_REQUIRED');
  }
});

test('staging access mode cannot be enabled outside the staging environment', () => {
  const result = stagingBoundaryError(new Request('https://prod.example/api/orders', {
    headers: { 'x-cisne-dispatch-secret': 'server-secret', 'oai-authenticated-user-id': 'trusted-user' },
  }), { RAILWAY_ENVIRONMENT_NAME: 'production', CISNE_STAGING_ACCESS_MODE: 'private', CISNE_TRUSTED_DISPATCH_SECRET: 'server-secret' });
  assert.equal(result?.status, 503);
  assert.equal(result?.code, 'INVALID_STAGING_ACCESS_CONFIGURATION');
});

test('non-staging integrations retain the original forwarded identity contract', () => {
  const result = stagingBoundaryError(new Request('https://app.example/api/orders', {
    headers: { 'oai-authenticated-user-id': 'trusted-user' },
  }), {});
  assert.equal(result, null);
});
