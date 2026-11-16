import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { configureRestrictedRailwayWorkerBindings } from './railway-wrangler-bindings.mjs';

const fixture = {
  CISNE_RAILWAY_WORKER_BINDINGS: 'restricted',
  CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false',
  RAILWAY_ENVIRONMENT_NAME: 'staging',
  RAILWAY_PROJECT_ID: 'synthetic-project',
  RAILWAY_SERVICE_ID: 'synthetic-service',
  CISNE_STAGING_READ_ONLY: 'true',
  CISNE_STAGING_ACCESS_MODE: 'private',
  DATABASE_URL: 'postgresql://fictional:secret-never-log@db.internal:5432/ci',
  AWS_SECRET_ACCESS_KEY: 'unrelated-secret-must-never-cross',
};

test('only approved names are declared; secret values and unrelated host env stay out', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cisne-worker-bindings-'));
  const file = path.join(dir, 'wrangler.json');
  try {
    writeFileSync(file, JSON.stringify({ main: 'worker.js', secrets: { required: ['EXISTING_ONLY'] } }));
    const count = configureRestrictedRailwayWorkerBindings(file, fixture);
    assert.ok(count > 0);
    const body = readFileSync(file, 'utf8');
    const json = JSON.parse(body);
    assert.ok(json.secrets.required.includes('DATABASE_URL'));
    assert.ok(json.secrets.required.includes('RAILWAY_ENVIRONMENT_NAME'));
    assert.ok(json.secrets.required.includes('CISNE_STAGING_READ_ONLY'));
    assert.ok(json.secrets.required.includes('EXISTING_ONLY'));
    assert.equal(body.includes('fictional:secret-never-log'), false);
    assert.equal(body.includes('unrelated-secret-must-never-cross'), false);
    assert.equal(body.includes('AWS_SECRET_ACCESS_KEY'), false);
    assert.equal(json.secrets.required.some((key, i, a) => i && key < a[i-1]), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('no opt-in means no changes and no accidental Worker environment injection', () => {
  assert.equal(configureRestrictedRailwayWorkerBindings('/does-not-exist', {}), 0);
});

test('fail closed on unrestricted import, missing database or non-staging deployment', () => {
  assert.throws(
    () => configureRestrictedRailwayWorkerBindings('/unused', { ...fixture, CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true' }),
    /NO-GO/);
  assert.throws(
    () => configureRestrictedRailwayWorkerBindings('/unused', { ...fixture, DATABASE_URL: '' }),
    /NO-GO/);
  assert.throws(
    () => configureRestrictedRailwayWorkerBindings('/unused', { ...fixture, RAILWAY_ENVIRONMENT_NAME: 'production' }),
    /NO-GO/);
  assert.throws(
    () => configureRestrictedRailwayWorkerBindings('/unused', { ...fixture, CISNE_STAGING_READ_ONLY: 'false' }),
    /NO-GO/);
});
