import test from 'node:test';
import assert from 'node:assert/strict';
import { safeErrorDiagnostics } from './error-diagnostics.mjs';

test('retains SQLSTATE and constraint identifiers without logging database details', () => {
  const error = Object.assign(new Error('duplicate key contains customer@email and SQL values'), {
    code: '23505', constraint: 'clients_owner_document_unique', detail: 'private value',
  });
  assert.deepEqual(safeErrorDiagnostics(error), { type: 'Error', sqlState: '23505', constraint: 'clients_owner_document_unique' });
});

test('rejects malformed diagnostic fields and omits raw error messages', () => {
  const error = Object.assign(new Error('postgres://user:password@host/database'), {
    code: '23505 SECRET', constraint: 'bad constraint value',
  });
  assert.deepEqual(safeErrorDiagnostics(error), { type: 'Error' });
});
