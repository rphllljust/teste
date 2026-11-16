import test from 'node:test';
import assert from 'node:assert/strict';
import { caseInsensitiveAscending, caseInsensitiveContains } from '../lib/api/postgres-query.mjs';
import { normalizeSql } from './raw-sql.mjs';

test('case-insensitive filters produce PostgreSQL ILIKE with a one-character escape', () => {
  const where = caseInsensitiveContains(['o.title', 'o.client', 'm.id']);
  assert.equal(where, "(o.title ILIKE ? ESCAPE '\\' OR o.client ILIKE ? ESCAPE '\\' OR m.id ILIKE ? ESCAPE '\\')");
  assert.equal(normalizeSql(`SELECT m.id FROM measurements m WHERE ${where}`, undefined, 3), "SELECT m.id FROM measurements m WHERE (o.title ILIKE $1 ESCAPE '\\' OR o.client ILIKE $2 ESCAPE '\\' OR m.id ILIKE $3 ESCAPE '\\')");
});

test('case-insensitive ordering uses PostgreSQL LOWER instead of SQLite collation', () => {
  assert.equal(caseInsensitiveAscending('o.title'), 'LOWER(o.title) ASC');
  assert.throws(() => caseInsensitiveAscending('title; DROP TABLE clients'), /Invalid SQL identifier/);
});
