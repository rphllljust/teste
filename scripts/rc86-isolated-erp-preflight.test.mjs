import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRC86IsolatedErpPredeploy } from './rc86-isolated-erp-preflight.mjs';

const bucket = 'rc84-nextcrm-isolated-objects-z0c7g4';
const isolated = {
  RAILWAY_PROJECT_ID: '0835d357-6037-42e6-a534-6456422e1cf3',
  RAILWAY_ENVIRONMENT_ID: 'c241a855-68b7-4d75-a722-b6a42c8581e9',
  RAILWAY_ENVIRONMENT_NAME: 'staging',
  RAILWAY_SERVICE_ID: 'fed95ca7-f373-4e6a-983f-2f591f26672e',
  RAILWAY_SERVICE_NAME: 'cisne-rc85-ephemeral-erp',
  NODE_ENV: 'production',
  PORT: '8787',
  CISNE_RAILWAY_WORKER_BINDINGS: 'restricted',
  CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
  CISNE_STAGING_ACCESS_MODE: 'private',
  CISNE_STAGING_READ_ONLY: 'true',
  CISNE_STAGING_ACTOR_ID: 'synthetic-actor-rc86',
  CISNE_STAGING_SESSION_SECRET: 'synthetic-session-secret-isolated-testing-20261117',
  CISNE_RC84_RAILWAY_BUCKET_MODE: 'true',
  CISNE_NEXTCRM_PRIVATE_ORIGIN: 'http://nextcrm-rc84-isolated-web.railway.internal:3000',
  CISNE_NEXTCRM_INSTANCE_KEY: 'rc84_isolated_hml',
  CISNE_NEXTCRM_BRIDGE_SECRET: 'b'.repeat(64),
  CISNE_NEXTCRM_MINIO_BUCKET: bucket,
  CISNE_NEXTCRM_MINIO_PUBLIC_ORIGIN: 'https://' + bucket + '.t3.storageapi.dev',
  DATABASE_URL: 'postgresql://cisne_rc85:test-only@cisne-rc85-ephemeral-pg.railway.internal:5432/cisne_rc85',
};

test('permits only the reviewed isolated ERP read-only staging configuration', () => {
  assert.deepEqual(validateRC86IsolatedErpPredeploy(isolated), []);
  assert.deepEqual(validateRC86IsolatedErpPredeploy({
    ...isolated,
    CISNE_NEXTCRM_MINIO_PUBLIC_ORIGIN: 'https://' + bucket + '.storage.railway.app',
  }), []);
});

const invalid = [
  ['wrong service', { RAILWAY_SERVICE_ID: 'legacy' }, 'RAILWAY_SERVICE_ID'],
  ['wrong project', { RAILWAY_PROJECT_ID: 'legacy' }, 'RAILWAY_PROJECT_ID'],
  ['production env', { RAILWAY_ENVIRONMENT_NAME: 'production' }, 'RAILWAY_ENVIRONMENT_NAME'],
  ['disallow writes', { CISNE_STAGING_READ_ONLY: 'false' }, 'CISNE_STAGING_READ_ONLY'],
  ['disallow public login', { CISNE_STAGING_LOGIN_HASH: 'a'.repeat(64) }, 'CISNE_STAGING_LOGIN_HASH'],
  ['disallow public origin', { CISNE_STAGING_PUBLIC_ORIGIN: 'https://bad.up.railway.app' }, 'CISNE_STAGING_PUBLIC_ORIGIN'],
  ['reject unrestricted env forwarding', { CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true' }, 'CLOUDFLARE_INCLUDE_PROCESS_ENV'],
  ['reject nonisolated mode', { CISNE_RC84_RAILWAY_BUCKET_MODE: 'false' }, 'CISNE_RC84_RAILWAY_BUCKET_MODE'],
  ['reject shared CRM', { CISNE_NEXTCRM_PRIVATE_ORIGIN: 'http://nextcrm-web.railway.internal:3000' }, 'CISNE_NEXTCRM_PRIVATE_ORIGIN'],
  ['reject shared bucket', { CISNE_NEXTCRM_MINIO_BUCKET: 'nextcrm' }, 'CISNE_NEXTCRM_MINIO_BUCKET'],
  ['reject unrelated host', { DATABASE_URL: 'postgresql://user:pass@nextcrm-postgres.railway.internal:5432/nextcrm' }, 'DATABASE_URL'],
  ['reject injected public S3', { CISNE_NEXTCRM_MINIO_PUBLIC_ORIGIN: 'https://attacker.example.invalid' }, 'CISNE_NEXTCRM_MINIO_PUBLIC_ORIGIN'],
  ['reject DB query injection', { DATABASE_URL: isolated.DATABASE_URL + '?sslmode=disable' }, 'DATABASE_URL'],
  ['reject invalid signer', { CISNE_NEXTCRM_BRIDGE_SECRET: 'bad' }, 'CISNE_NEXTCRM_BRIDGE_SECRET'],
];
for (const [label, changes, key] of invalid) {
  test(label, () => {
    const problems = validateRC86IsolatedErpPredeploy({ ...isolated, ...changes });
    assert.ok(problems.includes(key), 'invalid field must be reported by NAME');
    assert.ok(problems.every(problem => /^[A-Z_0-9]+$/.test(problem)));
  });
}

test('missing configuration is denied and secret values never appear in diagnostics', () => {
  const failures = validateRC86IsolatedErpPredeploy({});
  assert.ok(failures.length >= 15);
  assert.equal(JSON.stringify(failures).includes('test-only'), false);
  assert.equal(JSON.stringify(failures).includes('synthetic-session-secret'), false);
});
