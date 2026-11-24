import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import { Pool } from 'pg';
import { GET } from '../../app/api/accounting/journals/route';
import { closeDatabase } from '../../db/raw';
import { setTestIdentity } from '../../lib/api/test-identity.mjs';

if (process.env.NODE_ENV !== 'test') throw new Error('Integration harness must run with NODE_ENV=test');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for accounting integration tests');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const url = 'http://localhost/api/accounting/journals';
const request = (actor: string, search = '') => setTestIdentity(new Request(url + search), actor);

after(async () => { await closeDatabase(); await pool.end(); });

test('GET rejects anonymous and malformed requests with JSON', async () => {
  const unauthorized = await GET(new Request(url));
  assert.equal(unauthorized.status, 401);
  assert.match(unauthorized.headers.get('content-type') ?? '', /^application\/json\b/);
  assert.equal((await unauthorized.json()).code, 'AUTHENTICATION_REQUIRED');

  const invalid = await GET(request(randomUUID(), '?page=abc'));
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, 'VALIDATION_FAILED');
});

test('GET paginates persisted journals for the current actor and returns scaled totals', async () => {
  const actor = randomUUID();
  const otherActor = randomUUID();
  const accountId = randomUUID();
  const journalId = randomUUID();
  const now = new Date().toISOString();

  try {
    await pool.query(`INSERT INTO chart_accounts (id, code, name, type, created_at, actor_id, request_hash)
      VALUES ($1, $1, 'Conta de teste', 'asset', $2, $3, 'test')`, [accountId, now, actor]);
    await pool.query(`INSERT INTO journal_entries
      (id, effective_date, source_reference, description, status, expected_count, created_at, actor_id, request_hash, correlation_id)
      VALUES ($1, '2026-11-24', 'CI', 'Lançamento de teste', 'posted', 2, $2, $3, 'test', 'test')`, [journalId, now, actor]);
    await pool.query(`INSERT INTO journal_lines (id, entry_id, account_id, debit, credit)
      VALUES ($1, $3, $4, 125000, 0), ($2, $3, $4, 0, 125000)`, [randomUUID(), randomUUID(), journalId, accountId]);
    await pool.query(`INSERT INTO journal_entries
      (id, effective_date, source_reference, description, status, expected_count, created_at, actor_id, request_hash, correlation_id)
      SELECT $1 || '-' || n::text, '2026-11-01', 'CI', 'Paginação', 'posted', 0, $2, $1, 'test', 'test'
      FROM generate_series(1, 25) n`, [actor, now]);

    const first = await GET(request(actor));
    assert.equal(first.status, 200);
    assert.match(first.headers.get('content-type') ?? '', /^application\/json\b/);
    const pageOne = await first.json();
    assert.deepEqual(pageOne.pageInfo, { page: 1, total: 26, hasMore: true });
    assert.equal(pageOne.items.length, 25);
    assert.deepEqual(pageOne.items[0], {
      id: journalId, effectiveDate: '2026-11-24', sourceReference: 'CI', description: 'Lançamento de teste',
      status: 'posted', debitScaled: '125000', creditScaled: '125000', reversalOf: null,
    });

    const second = await GET(request(actor, '?page=2'));
    assert.equal(second.status, 200);
    const pageTwo = await second.json();
    assert.deepEqual(pageTwo.pageInfo, { page: 2, total: 26, hasMore: false });
    assert.equal(pageTwo.items.length, 1);
    assert.ok(!pageOne.items.some((item: { id: string }) => item.id === pageTwo.items[0].id));

    const isolated = await GET(request(otherActor));
    assert.equal(isolated.status, 200);
    const empty = await isolated.json();
    assert.deepEqual(empty.items, []);
    assert.deepEqual(empty.pageInfo, { page: 1, total: 0, hasMore: false });
  } finally {
    await pool.query('DELETE FROM journal_lines WHERE entry_id=$1', [journalId]);
    await pool.query('DELETE FROM journal_entries WHERE actor_id=$1', [actor]);
    await pool.query('DELETE FROM chart_accounts WHERE id=$1', [accountId]);
  }
});
