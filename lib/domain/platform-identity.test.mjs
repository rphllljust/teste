import test from 'node:test';
import assert from 'node:assert/strict';

import { requiresIndependentIdentity } from '../api/platform-identity.mjs';
import { requestContext } from '../api/http.ts';

test('Railway runtime requires independently verified identity', () => {
  assert.equal(requiresIndependentIdentity({RAILWAY_PROJECT_ID: 'project-id'}), true);
  assert.equal(requiresIndependentIdentity({RAILWAY_ENVIRONMENT_ID: 'env-id'}), true);
  assert.equal(requiresIndependentIdentity({RAILWAY_SERVICE_ID: 'service-id'}), true);
  assert.equal(requiresIndependentIdentity({CISNE_TARGET_PLATFORM: 'railway'}), true);
  assert.equal(requiresIndependentIdentity({}), false);
});

test('Railway refuses spoofable Sites identity header before accessing the database', () => {
  const previous = process.env.RAILWAY_PROJECT_ID;
  process.env.RAILWAY_PROJECT_ID = '1f68621a-d07b-476b-87cc-26de71473a3c';
  try {
    const request = new Request('http://localhost/api/orders', {
      headers: {'oai-authenticated-user-id': 'attacker'},
    });
    assert.throws(() => requestContext(request), error =>
      error.code === 'AUTH_PROVIDER_UNAVAILABLE' && error.status === 503,
    );
  } finally {
    if (previous === undefined) delete process.env.RAILWAY_PROJECT_ID;
    else process.env.RAILWAY_PROJECT_ID = previous;
  }
});

test('Sites dispatch identity contract remains unchanged outside Railway', () => {
  const original = Object.fromEntries(
    ['RAILWAY_PROJECT_ID', 'RAILWAY_ENVIRONMENT_ID', 'RAILWAY_SERVICE_ID', 'CISNE_TARGET_PLATFORM']
      .map(key => [key, process.env[key]])
  );
  for (const key of Object.keys(original)) delete process.env[key];
  try {
    const request = new Request('https://sites.example/api/orders', {
      headers: {'oai-authenticated-user-id': 'trusted-user'},
    });
    assert.equal(requestContext(request).actorId, 'trusted-user');
    assert.throws(
      () => requestContext(new Request('https://sites.example/api/orders')),
      error => error.code === 'AUTHENTICATION_REQUIRED',
    );
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value !== undefined) process.env[key] = value;
    }
  }
});
