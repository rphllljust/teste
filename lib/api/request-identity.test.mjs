import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRequestActor, isRailwayRuntime } from './request-identity.mjs';
import { issueStagingSession, CISNE_STAGING_COOKIE } from './staging-session.mjs';

const forged = () => new Request('https://example.up.railway.app/api/orders', {
  headers: {
    'oai-authenticated-user-id': 'administrator',
    'x-cisne-dispatch-secret': 'attacker-chosen-secret',
    'x-forwarded-user': 'administrator',
  },
});

test('Railway production denies forged identity regardless of forwarded headers', () => {
  for (const env of [
    { RAILWAY_ENVIRONMENT_NAME: 'production' },
    { RAILWAY_ENVIRONMENT_NAME: 'preview' },
    { RAILWAY_PROJECT_ID: 'any-project' },
    { RAILWAY_ENVIRONMENT_ID: 'any-env', NODE_ENV: 'test' },
    { RAILWAY_SERVICE_ID: 'any-service' },
    { RAILWAY_PUBLIC_DOMAIN: 'example.up.railway.app' },
  ]) {
    assert.equal(isRailwayRuntime(env), true);
    assert.equal(resolveRequestActor(forged(), env), null);
  }
});

test('public non-Railway installations also refuse unsigned forwarded identity', () => {
  assert.equal(resolveRequestActor(forged(), { NODE_ENV: 'production' }), null);
  assert.equal(resolveRequestActor(forged(), {}), null);
});

test('Railway staging accepts only a correctly signed, unexpired session cookie', () => {
  const env = {
    RAILWAY_ENVIRONMENT_NAME: 'staging',
    CISNE_STAGING_ACTOR_ID: 'synthetic-uat-operator',
    CISNE_STAGING_SESSION_SECRET: 'staging-hmac-test-secret-minimum-32-bytes-20261116',
  };
  assert.equal(resolveRequestActor(forged(), env), null);
  const token = issueStagingSession(env.CISNE_STAGING_ACTOR_ID, env.CISNE_STAGING_SESSION_SECRET);
  const authorized = new Request('https://example.up.railway.app/api/orders', {
    headers: {
      cookie: CISNE_STAGING_COOKIE + '=' + token,
      'oai-authenticated-user-id': 'different-forged-actor',
    },
  });
  assert.equal(resolveRequestActor(authorized, env), env.CISNE_STAGING_ACTOR_ID);
  assert.equal(resolveRequestActor(authorized, {
    ...env, CISNE_STAGING_ACTOR_ID: 'other-operator',
  }), null);
});
