import test from 'node:test';
import assert from 'node:assert/strict';
import { publicNextcrmLinkedDocument } from '../../lib/integrations/nextcrm/public-document-projection.ts';

test('authorized documents expose only local link ID and bounded public metadata', () => {
  const localId = '7bafe074-874d-42eb-820b-8270aaccec87';
  const upstreamId = 'PRIVATE_NEXTCRM_EXTERNAL_DOCUMENT_456';
  const row = {
    id: localId, document_kind: 'attachment', document_version: 3,
    created_at: '2026-11-16T14:00:00Z',
    nextcrm_document_id: upstreamId,
    nextcrm_account_id: 'SECRET_ACCOUNT_ID',
    tenant_key: 'SECRET_TENANT',
    secret: 'NEVER_RETURN_BRIDGE_SECRET',
    presigned_url: 'https://internal-private.example.invalid/?token=secret',
    owner_id: 'INTERNAL_OWNER',
    sha256: '0'.repeat(64),
  };
  const verifiedDigest = 'f'.repeat(64);
  const safe = publicNextcrmLinkedDocument(row, verifiedDigest);
  assert.deepEqual(safe, {
    id: localId,
    kind: 'attachment', version: 3, linkedAt: '2026-11-16T14:00:00Z',
    sha256: verifiedDigest,
  });
  const serialized = JSON.stringify(safe);
  for (const hidden of [
    upstreamId, 'SECRET_ACCOUNT_ID', 'SECRET_TENANT',
    'NEVER_RETURN_BRIDGE_SECRET', 'internal-private.example.invalid',
    'INTERNAL_OWNER',
  ]) {
    assert.ok(!serialized.includes(hidden), 'private field leaked into browser payload');
  }
  assert.deepEqual(Object.keys(safe).sort(),
    ['id', 'kind', 'version', 'sha256', 'linkedAt'].sort());
});

test('projection preserves minimal information when upstream SHA is unavailable', () => {
  const safe = publicNextcrmLinkedDocument({
    id: 'local-document-link', document_kind: 'contract', document_version: 1,
    created_at: '2026-11-15T22:00:00Z',
  }, null);
  assert.equal(safe.sha256, null);
  assert.equal(safe.id, 'local-document-link');
});
