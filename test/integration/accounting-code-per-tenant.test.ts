import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { setTestIdentity } from '../../lib/api/test-identity.mjs';
import { closeDatabase } from '../../db/raw';
import { POST as createAccount, GET as listAccounts } from '../../app/api/accounting/accounts/route';

if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL)
  throw new Error('NO-GO: tenant chart accounts need disposable PostgreSQL');
const dbUrl = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(dbUrl.hostname) ||
    dbUrl.port !== '5432' || !['/cisne_ci', '/cisne_test'].includes(dbUrl.pathname))
  throw new Error('NO-GO: refusing chart account mutations outside isolated test database');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const ownerA = randomUUID(), ownerB = randomUUID();
const ids = [randomUUID(), randomUUID(), randomUUID()];
const code = 'CI-TENANT-' + randomUUID().replaceAll('-', '').slice(0, 14);
const request = (method: 'GET' | 'POST', owner: string, data?: unknown) =>
  setTestIdentity(new Request('http://localhost/api/accounting/accounts', {
    method,
    headers: { 'content-type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  }), owner);
const account = (id: string) => ({ id, code, name: 'Conta padrão independente', type: 'asset' });

after(async () => {
  try {
    await pool.query('DELETE FROM chart_accounts WHERE id=ANY($1::text[])', [ids]);
  } finally {
    await closeDatabase();
    await pool.end();
  }
});

test('two tenants can use the same chart code without granting cross-owner access or duplicates', async () => {
  const responses = await Promise.all([
    createAccount(request('POST', ownerA, account(ids[0]))),
    createAccount(request('POST', ownerB, account(ids[1]))),
  ]);
  assert.deepEqual(responses.map(r => r.status), [201, 201],
    'A standard chart code must be usable by two independent organizations');

  const sameOwner = await createAccount(request('POST', ownerA, account(ids[2])));
  assert.equal(sameOwner.status, 409, 'The same organization must not duplicate its account code');
  assert.equal((await sameOwner.json() as {code: string}).code, 'ACCOUNT_CONFLICT');

  const foreignId = await createAccount(request('POST', ownerB, account(ids[0])));
  assert.equal(foreignId.status, 409, 'Another organization may not take over an existing account ID');

  const persisted = await pool.query(
    'SELECT id,actor_id,code FROM chart_accounts WHERE id=ANY($1::text[]) ORDER BY id', [ids]);
  assert.equal(persisted.rowCount, 2);
  assert.deepEqual(new Set(persisted.rows.map(row => row.actor_id)), new Set([ownerA, ownerB]));
  assert.ok(persisted.rows.every(row => row.code === code));

  for (const [owner, own, foreign] of [[ownerA, ids[0], ids[1]], [ownerB, ids[1], ids[0]]] as const) {
    const listed = await listAccounts(request('GET', owner));
    assert.equal(listed.status, 200);
    const body = await listed.json() as {items: Array<{id: string; code: string}>};
    assert.ok(body.items.some(item => item.id === own && item.code === code));
    assert.ok(!body.items.some(item => item.id === foreign), 'Cross-organization rows must be invisible');
  }
});
