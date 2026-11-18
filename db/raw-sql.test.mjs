import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSql } from './raw-sql.mjs';

test('converts bound placeholders in a representative procurement query', () => {
  const sql = "SELECT p.id FROM supplier_purchase_orders p WHERE p.owner_id=? AND (LOWER(p.reference) LIKE '%' || LOWER(?) || '%') ORDER BY p.created_at DESC LIMIT ? OFFSET ?";
  assert.equal(normalizeSql(sql, undefined, 4), "SELECT p.id FROM supplier_purchase_orders p WHERE p.owner_id=$1 AND (LOWER(p.reference) LIKE '%' || LOWER($2) || '%') ORDER BY p.created_at DESC LIMIT $3 OFFSET $4");
});

test('leaves question marks and D1 words in strings, identifiers, and comments untouched', () => {
  const sql = "SELECT '?' AS literal, \"changes()?\" FROM clients -- ? changes()\nWHERE owner_id=? AND note='instr(lower(x), lower(?))' /* ? */";
  assert.equal(normalizeSql(sql, undefined, 1), "SELECT '?' AS literal, \"changes()?\" FROM clients -- ? changes()\nWHERE owner_id=$1 AND note='instr(lower(x), lower(?))' /* ? */");
});

test('handles SQLite ESCAPE backslashes without swallowing following placeholders', () => {
  const sql = "SELECT id FROM clients WHERE name LIKE ? ESCAPE '\\' AND owner_id=?";
  assert.equal(normalizeSql(sql, undefined, 2), "SELECT id FROM clients WHERE name LIKE $1 ESCAPE '\\' AND owner_id=$2");
});

test('translates changes() using the immediately preceding statement row count', () => {
  assert.equal(normalizeSql('INSERT INTO order_events(id) SELECT id FROM service_orders WHERE changes()=1', 1, 0), 'INSERT INTO order_events(id) SELECT id FROM service_orders WHERE 1=1');
  assert.equal(normalizeSql('INSERT INTO order_events(id) SELECT id FROM service_orders WHERE changes()=1', 0, 0), 'INSERT INTO order_events(id) SELECT id FROM service_orders WHERE 0=1');
  assert.throws(() => normalizeSql('SELECT changes()', undefined, 0), /only supported inside a transactional batch/);
});

test('preserves PostgreSQL dollar-quoted bodies and ignores placeholder characters within them', () => {
  const sql = "DO $tag$ BEGIN RAISE NOTICE '? changes()'; END $tag$; SELECT id FROM clients WHERE owner_id=?";
  assert.equal(normalizeSql(sql, undefined, 1), "DO $tag$ BEGIN RAISE NOTICE '? changes()'; END $tag$; SELECT id FROM clients WHERE owner_id=$1");
});

test('rejects parameter count mismatches and unsupported SQLite functions', () => {
  assert.throws(() => normalizeSql('SELECT * FROM clients WHERE id=?', undefined, 2), /parameter count mismatch/);
  assert.throws(() => normalizeSql('SELECT instr(name, ?) FROM clients', undefined, 1), /rewrite this query with PostgreSQL POSITION/);
});
