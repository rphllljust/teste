import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNextcrmOrderDocumentLinkInput } from './document-link-contract.ts';

const valid = Object.freeze({
  serviceOrderId: 'a2345678-b123-4a56-8123-123456789abc',
  nextcrmDocumentId: 'clcDocument_42',
  documentKind: 'service_report',
  version: 1,
  sha256: 'f'.repeat(64),
});

test('accepts a bounded, versioned and hashed document-to-OS intent', () => {
  assert.deepEqual(validateNextcrmOrderDocumentLinkInput(valid), valid);
});

test('rejects caller-provided owner or tenant to prevent trusted-scope spoofing', () => {
  for (const field of ['ownerId', 'tenantId', 'publicUrl']) {
    assert.throws(() => validateNextcrmOrderDocumentLinkInput({ ...valid, [field]: 'injected' }));
  }
});

test('rejects file paths, URL-like document IDs and untrusted extra fields', () => {
  for (const id of ['../../private', 'https://example.com/document', '', '/tmp/file']) {
    assert.throws(() => validateNextcrmOrderDocumentLinkInput({ ...valid, nextcrmDocumentId: id }));
  }
});

test('rejects invalid order IDs, unsupported categories and invalid versions', () => {
  assert.throws(() => validateNextcrmOrderDocumentLinkInput({ ...valid, serviceOrderId: 'OS-001' }));
  assert.throws(() => validateNextcrmOrderDocumentLinkInput({ ...valid, documentKind: 'admin' }));
  for (const version of [0, -1, 1.5]) {
    assert.throws(() => validateNextcrmOrderDocumentLinkInput({ ...valid, version }));
  }
});

test('rejects incorrect content hashes and permits optional hash', () => {
  assert.throws(() => validateNextcrmOrderDocumentLinkInput({ ...valid, sha256: 'not-a-hash' }));
  const {sha256, ...withoutHash} = valid;
  assert.deepEqual(validateNextcrmOrderDocumentLinkInput(withoutHash), withoutHash);
});
