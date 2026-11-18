import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateNextcrmReadiness, isBridgeSecretConfigured } from './readiness.ts';

const base = {
  environment: 'staging',
  publicUrl: 'https://nextcrm-gateway-staging.up.railway.app',
  bridgeSecretConfigured: true,
  instanceKey: 'cisne-hml-2026',
  schemaApplied: true,
  activeIdentityMappings: 1,
  activeAccountMappings: 1,
};

test('reports ready only when the isolated bridge and approved mappings exist', () => {
  assert.equal(evaluateNextcrmReadiness(base).ready, true);
  assert.deepEqual(evaluateNextcrmReadiness(base).blockers, []);
});

test('keeps production and unsafe URLs disabled', () => {
  const result = evaluateNextcrmReadiness({
    ...base,
    environment: 'production',
    publicUrl: 'https://nextcrm.example.test:3000/?token=bad',
  });
  assert.equal(result.enabled, false);
  assert.equal(result.ready, false);
  assert.deepEqual(result.blockers, ['STAGING_ONLY', 'PUBLIC_URL_NOT_APPROVED']);
});

test('does not mistake infrastructure for homologation', () => {
  const result = evaluateNextcrmReadiness({
    ...base,
    schemaApplied: false,
    activeIdentityMappings: 0,
    activeAccountMappings: 0,
  });
  assert.equal(result.enabled, true);
  assert.equal(result.ready, false);
  assert.deepEqual(result.blockers, [
    'MIGRATION_NOT_APPLIED',
    'IDENTITY_MAPPING_REQUIRED',
    'ACCOUNT_MAPPING_REQUIRED',
  ]);
});

test('validates bridge secret shape without exposing it', () => {
  assert.equal(isBridgeSecretConfigured('f'.repeat(64)), true);
  assert.equal(isBridgeSecretConfigured('short'), false);
  assert.equal(isBridgeSecretConfigured(undefined), false);
});
