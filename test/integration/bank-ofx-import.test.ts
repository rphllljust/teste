import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { closeDatabase } from '../../db/raw';
import { setTestIdentity } from '../../lib/api/test-identity.mjs';
import { POST as importOfx } from '../../app/api/bank/ofx/route';

const url = process.env.DATABASE_URL;
if (process.env.NODE_ENV !== 'test' || !url)
  throw new Error('OFX Tier 1 integration test requires an isolated PostgreSQL test database.');
const target = new URL(url);
if (!['localhost', '127.0.0.1'].includes(target.hostname) ||
    !['/cisne_test', '/cisne_ci'].includes(target.pathname) ||
    !['cisne_test', 'cisne_ci'].includes(target.username))
  throw new Error('NO-GO: OFX business test refuses production or shared PostgreSQL.');
const pool = new Pool({ connectionString: url, max: 2 });
after(async () => { await closeDatabase(); await pool.end(); });

const owner = randomUUID();
const otherOwner = randomUUID();
const fitid = randomUUID();
const ofx = [
  'OFXHEADER:100','DATA:OFXSGML','VERSION:102','',
  '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL',
  '<BANKACCTFROM><BANKID>001<ACCTID>120-01</BANKACCTFROM>',
  '<BANKTRANLIST><DTSTART>20261001000000<DTEND>20261031235959',
  '<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261011<TRNAMT>24.5000<FITID>' + fitid + '<NAME>Recebimento fictício',
  '</BANKTRANLIST><LEDGERBAL><BALAMT>124.5000</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>'
].join('\n');
function request(actor: string | null, data: unknown) {
  const req = new Request('http://localhost/api/bank/ofx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return actor ? setTestIdentity(req, actor) : req;
}
test('OFX API: requires auth, rejects malformed currency and never persists failed import', async () => {
  assert.equal((await importOfx(request(null, { ofx }))).status, 401);
  const malformed = await importOfx(request(owner, { ofx: ofx.replace('<CURDEF>BRL', '<CURDEF>USD') }));
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json() as { code: string }).code, 'OFX_VALIDATION_FAILED');
  assert.equal(Number((await pool.query('SELECT count(*) AS n FROM bank_statements WHERE actor_id=$1', [owner])).rows[0].n), 0);
});
test('OFX API: creates owner-scoped statement and lines atomically; stable replay; distinct tenant', async () => {
  const response = await importOfx(request(owner, { ofx }));
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  const created = await response.json() as { id: string };
  assert.match(created.id, /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/);
  const stmt = await pool.query(
    'SELECT account_reference,opening_balance,closing_balance,expected_count,source_reference FROM bank_statements WHERE id=$1 AND actor_id=$2',
    [created.id, owner],
  );
  assert.equal(stmt.rowCount, 1);
  assert.equal(stmt.rows[0].opening_balance, 1000000);
  assert.equal(stmt.rows[0].closing_balance, 1245000);
  assert.equal(stmt.rows[0].expected_count, 1);
  assert.equal(stmt.rows[0].account_reference, '001:120-01');
  assert.match(stmt.rows[0].source_reference, /^OFX:/);
  const rows = await pool.query('SELECT external_key,amount FROM bank_statement_lines WHERE statement_id=$1', [created.id]);
  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0].external_key, fitid);
  assert.equal(rows.rows[0].amount, 245000);
  const duplicate = await importOfx(request(owner, { ofx }));
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json() as { replayed: boolean }).replayed, true);
  assert.equal(Number((await pool.query('SELECT count(*) AS n FROM bank_statement_lines WHERE statement_id=$1', [created.id])).rows[0].n), 1);
  const foreign = await importOfx(request(otherOwner, { ofx }));
  assert.equal(foreign.status, 201, JSON.stringify(await foreign.clone().json()));
  assert.notEqual((await foreign.json() as { id: string }).id, created.id);
  const distinct = await pool.query('SELECT actor_id,count(*)::int AS n FROM bank_statements WHERE actor_id=ANY($1::text[]) GROUP BY actor_id', [[owner, otherOwner]]);
  assert.equal(distinct.rows.length, 2);
  assert.ok(distinct.rows.every(r => r.n === 1));
});
