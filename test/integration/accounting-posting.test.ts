import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { closeDatabase } from '../../db/raw';
import { setTestIdentity } from '../../lib/api/test-identity.mjs';
import { POST as postJournal } from '../../app/api/accounting/journals/route';
import { POST as reverseJournal } from '../../app/api/accounting/journals/[id]/reverse/route';

if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL) {
  throw new Error('Accounting posting tests require isolated PostgreSQL and NODE_ENV=test');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const actor = randomUUID();
const debitAccount = randomUUID();
const creditAccount = randomUUID();
const journalId = randomUUID();
const date = '2026-12-10';
const request = (url: string, payload: unknown) => setTestIdentity(new Request('http://localhost' + url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
}), actor);
const lines = () => [
  { id: randomUUID(), accountId: debitAccount, debit: '125000', credit: '0' },
  { id: randomUUID(), accountId: creditAccount, debit: '0', credit: '125000' },
];
const payload = (id: string, effectiveDate = date) => ({
  id, effectiveDate, sourceReference: 'CI-MEAS-001', description: 'Contabilização de homologação', lines: lines(),
});

before(async () => {
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO chart_accounts(id,code,name,type,created_at,actor_id,request_hash)
     VALUES($1,$1,'CI debit','asset',$3,$2,'ci'),($4,$4,'CI credit','revenue',$3,$2,'ci')`,
    [debitAccount, actor, now, creditAccount],
  );
});

after(async () => {
  await pool.query('DELETE FROM journal_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE actor_id=$1)', [actor]);
  await pool.query('DELETE FROM journal_entries WHERE actor_id=$1', [actor]);
  await pool.query('DELETE FROM business_commands WHERE actor_id=$1', [actor]);
  await pool.query('DELETE FROM finance_period_closes WHERE actor_id=$1', [actor]);
  await pool.query('DELETE FROM chart_accounts WHERE actor_id=$1', [actor]);
  await closeDatabase();
  await pool.end();
});

test('journal posting requires exclusive debit/credit, preserves idempotency and respects period close', async () => {
  const input = payload(journalId);
  const accepted = await postJournal(request('/api/accounting/journals', input));
  assert.equal(accepted.status, 201, JSON.stringify(await accepted.clone().json()));
  const posted = await pool.query(
    'SELECT debit,credit FROM journal_lines WHERE entry_id=$1 ORDER BY debit DESC', [journalId],
  );
  assert.deepEqual(posted.rows, [{ debit: 125000, credit: 0 }, { debit: 0, credit: 125000 }]);

  const replay = await postJournal(request('/api/accounting/journals', input));
  assert.equal(replay.status, 200);

  const invalid = payload(randomUUID());
  invalid.lines[0].credit = '1';
  const rejected = await postJournal(request('/api/accounting/journals', invalid));
  assert.equal(rejected.status, 400);

  const unbalanced = payload(randomUUID());
  unbalanced.lines[1].credit = '124999';
  assert.equal((await postJournal(request('/api/accounting/journals', unbalanced))).status, 409);

  await pool.query(
    `INSERT INTO finance_period_closes(id,period_start,period_end,status,actor_id,request_hash,correlation_id,closed_at)
     VALUES($1,'2026-12-01','2026-12-31','closed',$2,$3,'ci',$4)`,
    [randomUUID(), actor, randomUUID(), new Date().toISOString()],
  );
  const closed = await postJournal(request('/api/accounting/journals', payload(randomUUID())));
  assert.equal(closed.status, 409);
  assert.equal((await closed.json() as { code: string }).code, 'FINANCE_PERIOD_CLOSED');

  const reversal = await reverseJournal(request(`/api/accounting/journals/${journalId}/reverse`, {
    commandKey: randomUUID(), effectiveDate: date, sourceReference: 'CI-REV',
    description: 'Estorno em período fechado',
  }), { params: Promise.resolve({ id: journalId }) });
  assert.equal(reversal.status, 409);
  assert.equal((await reversal.json() as { code: string }).code, 'FINANCE_PERIOD_CLOSED');
  assert.equal((await postJournal(request('/api/accounting/journals', input))).status, 200);
});
