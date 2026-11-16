import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isDocumentKey,
  documentFileRoute,
  keyFromUrl,
  isUploadThingUrl,
  withDocumentFileRoutes,
} from '../../../integrations/nextcrm-upstream/lib/documents/file-key.ts';

test('upstream permits only recognized private document folders and rejects traversal', () => {
  assert.equal(isDocumentKey('documents/123/file.pdf'), true);
  assert.equal(isDocumentKey('images/123.png'), true);
  assert.equal(isDocumentKey('uploads/abc'), true);
  assert.equal(isDocumentKey('avatars/public.jpg'), false);
  assert.equal(isDocumentKey('../private/file.pdf'), false);
  assert.equal(isDocumentKey('documents/../file.pdf'), false);
  assert.equal(isDocumentKey('documents'), false);
});

test('upstream maps document reads to a protected app route, not raw object URLs', () => {
  assert.equal(documentFileRoute('doc123'), '/api/documents/doc123/file');
  const source = {
    documents: [{id:'doc123',document_file_url:'https://private.example/nextcrm/documents/abc.pdf'}],
    nested: {id:'doc456',document_file_url:'https://private.example/nextcrm/documents/def.pdf'},
  };
  const result = withDocumentFileRoutes(source);
  assert.equal(result.documents[0].document_file_url, '/api/documents/doc123/file');
  assert.equal(result.nested.document_file_url, '/api/documents/doc456/file');
  assert.ok(!JSON.stringify(result).includes('private.example'));
});

test('upstream suppresses raw file URLs when a selected document lacks its id', () => {
  const result = withDocumentFileRoutes({document_file_url:'https://private.example/secret.pdf'});
  assert.equal(result.document_file_url,'');
});

test('upstream accepts legacy key recovery only for permitted storage origins', () => {
  const accepted='https://storage.example/nextcrm/documents/some.pdf';
  assert.equal(keyFromUrl(accepted,'nextcrm',['https://storage.example']), 'documents/some.pdf');
  assert.equal(keyFromUrl(accepted,'nextcrm',['https://unrelated.example']),null);
  assert.equal(keyFromUrl('https://evil.example/nextcrm/documents/some.pdf','nextcrm',['https://storage.example']),null);
  assert.equal(keyFromUrl('not a url','nextcrm',['https://storage.example']),null);
});

test('legacy file URL handling recognizes only approved UploadThing domains over https', () => {
  assert.equal(isUploadThingUrl('https://utfs.io/f/document123'),true);
  assert.equal(isUploadThingUrl('https://uploadthing.com/f/document123'),true);
  assert.equal(isUploadThingUrl('http://utfs.io/f/document123'),false);
  assert.equal(isUploadThingUrl('https://utfs.io.evil.example/f/document123'),false);
});
