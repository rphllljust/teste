import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { setTestIdentity } from '../../lib/api/test-identity.mjs';
import { closeDatabase } from '../../db/raw';
import { GET as listAccounts, POST as createAccount } from '../../app/api/accounting/accounts/route';
import { GET as listJournals, POST as createJournal } from '../../app/api/accounting/journals/route';
import { GET as journalDetail } from '../../app/api/accounting/journals/[id]/route';

if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL)
  throw new Error('NO-GO: accounting owner tests require disposable PostgreSQL');
const url = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(url.hostname) ||
    !['/cisne_test', '/cisne_ci'].includes(url.pathname) || url.port !== '5432')
  throw new Error('NO-GO: refusing accounting mutations outside isolated CI PostgreSQL');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const alice = randomUUID(), bob = randomUUID();
const aliceAccounts = [randomUUID(), randomUUID()];
const bobAccounts = [randomUUID(), randomUUID()];
const journalIds = [randomUUID(), randomUUID(), randomUUID()];
const request = (method: 'GET' | 'POST', path: string, actor: string, data?: unknown) =>
  setTestIdentity(new Request('http://localhost' + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  }), actor);
const body = async (r: Response) => r.clone().json() as Promise<Record<string, unknown>>;
const entries = (id: string, accounts: string[]) => ({
  id,
  effectiveDate: '2026-11-22',
  sourceReference: 'CI-ACCOUNTING-OWNER',
  description: 'Lançamento isolado de proprietário',
  lines: [
    { accountId: accounts[0], side: 'debit', amount: '10,00' },
    { accountId: accounts[1], side: 'credit', amount: '10,00' },
  ],
});

after(async () => {
  try {
    await pool.query('DELETE FROM journal_lines WHERE entry_id=ANY($1::text[])', [journalIds]);
    await pool.query('DELETE FROM journal_entries WHERE id=ANY($1::text[])', [journalIds]);
    await pool.query('DELETE FROM chart_accounts WHERE id=ANY($1::text[])', [[...aliceAccounts, ...bobAccounts]]);
  } finally {
    await closeDatabase();
    await pool.end();
  }
});

test('chart accounts are private: listing, journal posting and detail never cross owners', async () => {
  for (const [actor, accounts] of [[alice, aliceAccounts], [bob, bobAccounts]] as const) {
    for (const id of accounts) {
      const result = await createAccount(request('POST', '/api/accounting/accounts', actor, {
        id,
        code: 'CI-' + id.replaceAll('-', '').slice(0, 20),
        name: 'Conta sintética isolada',
        type: 'asset',
      }));
      assert.equal(result.status, 201, JSON.stringify(await body(result)));
    }
  }

  for (const [actor, own, foreign] of [
    [alice, aliceAccounts, bobAccounts],
    [bob, bobAccounts, aliceAccounts],
  ] as const) {
    const result = await listAccounts(request('GET', '/api/accounting/accounts', actor));
    assert.equal(result.status, 200);
    const ids = new Set((await body(result)).items as Array<{ id: string }>);
    const idSet = new Set([...ids].map(value => value.id));
    for (const id of own) assert.ok(idSet.has(id), 'Owner must see their own account');
    for (const id of foreign) assert.ok(!idSet.has(id), 'Foreign active account must be hidden');
  }

  const accepted = await createJournal(request('POST', '/api/accounting/journals', alice,
    entries(journalIds[0], aliceAccounts)));
  assert.equal(accepted.status, 201, JSON.stringify(await body(accepted)));

  // IDs and even active foreign account IDs do not grant journal-posting authority.
  const foreign = await createJournal(request('POST', '/api/accounting/journals', bob,
    entries(journalIds[1], aliceAccounts)));
  assert.equal(foreign.status, 400, 'Second owner cannot post against the first owner accounts');
  const mixed = await createJournal(request('POST', '/api/accounting/journals', alice,
    entries(journalIds[2], [aliceAccounts[0], bobAccounts[0]])));
  assert.equal(mixed.status, 400, 'Mixed-owner journal lines must be rejected atomically');

  const persisted = await pool.query(
    'SELECT id,actor_id FROM journal_entries WHERE id=ANY($1::text[])', [journalIds]);
  assert.deepEqual(persisted.rows, [{ id: journalIds[0], actor_id: alice }]);
  const lines = await pool.query(
    'SELECT account_id FROM journal_lines WHERE entry_id=$1 ORDER BY id', [journalIds[0]]);
  assert.deepEqual(new Set(lines.rows.map(x => x.account_id)), new Set(aliceAccounts));

  const ownerDetail = await journalDetail(request('GET', '/api/accounting/journals/' + journalIds[0], alice),
    { params: Promise.resolve({ id: journalIds[0] }) });
  assert.equal(ownerDetail.status, 200);
  const foreignDetail = await journalDetail(request('GET', '/api/accounting/journals/' + journalIds[0], bob),
    { params: Promise.resolve({ id: journalIds[0] }) });
  assert.equal(foreignDetail.status, 404);

  const ownerJournalList = await listJournals(request('GET', '/api/accounting/journals', alice));
  const foreignJournalList = await listJournals(request('GET', '/api/accounting/journals', bob));
  assert.ok(((await body(ownerJournalList)).items as Array<{ id: string }>).some(row => row.id === journalIds[0]));
  assert.ok(!((await body(foreignJournalList)).items as Array<{ id: string }>).some(row => row.id === journalIds[0]));
});
