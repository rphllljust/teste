import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, requestContext } from './http.ts';

const originalEnvironment = process.env.RAILWAY_ENVIRONMENT_NAME;
const originalDemoMode = process.env.CISNE_PUBLIC_DEMO_MODE;

test('staging public demo blocks business APIs even when a caller forges the identity header', () => {
  process.env.RAILWAY_ENVIRONMENT_NAME = 'staging';
  process.env.CISNE_PUBLIC_DEMO_MODE = 'true';
  try {
    assert.throws(
      () => requestContext(new Request('https://example.test/api/orders', {
        headers: { 'oai-authenticated-user-id': 'forged-user' },
      })),
      (error) => error instanceof ApiError && error.status === 403 && error.code === 'DEMO_READ_ONLY',
    );
  } finally {
    if (originalEnvironment === undefined) delete process.env.RAILWAY_ENVIRONMENT_NAME;
    else process.env.RAILWAY_ENVIRONMENT_NAME = originalEnvironment;
    if (originalDemoMode === undefined) delete process.env.CISNE_PUBLIC_DEMO_MODE;
    else process.env.CISNE_PUBLIC_DEMO_MODE = originalDemoMode;
  }
});

test('without demo mode an identity in the body or an arbitrary header is not accepted', () => {
  delete process.env.CISNE_PUBLIC_DEMO_MODE;
  process.env.RAILWAY_ENVIRONMENT_NAME = 'staging';
  assert.throws(
    () => requestContext(new Request('https://example.test/api/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user-id': 'forged-user' },
      body: JSON.stringify({ actorId: 'forged-user' }),
    })),
    (error) => error instanceof ApiError && error.status === 401,
  );
});

test.after(() => {
  if (originalEnvironment === undefined) delete process.env.RAILWAY_ENVIRONMENT_NAME;
  else process.env.RAILWAY_ENVIRONMENT_NAME = originalEnvironment;
  if (originalDemoMode === undefined) delete process.env.CISNE_PUBLIC_DEMO_MODE;
  else process.env.CISNE_PUBLIC_DEMO_MODE = originalDemoMode;
});
