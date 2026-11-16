import test from 'node:test';
import assert from 'node:assert/strict';
import { railwayIdentityBoundaryError } from './railway-identity-boundary.mjs';

test('public Railway production denies identity regardless of forged actor headers', () => {
  for (const environment of ['production', 'preview', undefined]) {
    const env = { RAILWAY_SERVICE_ID: 'railway-service', RAILWAY_ENVIRONMENT_NAME: environment };
    const result = railwayIdentityBoundaryError(env);
    assert.equal(result?.status, 503);
    assert.equal(result?.code, 'RAILWAY_TRUSTED_IDENTITY_REQUIRED');
  }
});

test('staging continues under its separate signed-cookie guard', () => {
  assert.equal(railwayIdentityBoundaryError({
    RAILWAY_SERVICE_ID: 'railway-service',
    RAILWAY_ENVIRONMENT_NAME: 'staging',
  }), null);
});

test('Sites dispatch identity contract stays separate from public Railway domains', () => {
  assert.equal(railwayIdentityBoundaryError({ NODE_ENV: 'production' }), null);
});
