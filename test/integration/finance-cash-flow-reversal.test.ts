import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { setTestIdentity } from '../../lib/api/test-identity.mjs';
import { closeDatabase } from '../../db/raw';
import { GET as getCashFlow } from '../../app/api/finance/cash-flow/route';
import { POST as recordReceipt } from '../../app/api/finance/receivables/settlements/route';
import { POST as reverseReceipt } from '../../app/api/finance/receivables/settlements/[id]/reverse/route';
import { POST as recordPayment } from '../../app/api/finance/payables/payments/route';
import { POST as reversePayment } from '../../app/api/finance/payables/payments/[id]/reverse/route';

if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL)
  throw new Error('NO-GO: cash-flow reversals require disposable PostgreSQL');
const dbUrl = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(dbUrl.hostname) ||
    !['/cisne_test', '/cisne_ci'].includes(dbUrl.pathname) || dbUrl.port !== '5432')
  throw new Error('NO-GO: refusing cash-flow writes outside isolated CI PostgreSQL');

const pool = new Pool({connectionString: process.env.DATABASE_URL, max: 2});
const ownerA = randomUUID(), ownerB = randomUUID();
const fixtures = [ownerA, ownerB].map(owner => ({
  owner, order: randomUUID(), measurement: randomUUID(), invoice: randomUUID(),
  receivable: randomUUID(), payable: randomUUID(),
}));
const keys = Array.from({length: 8}, () => randomUUID());
const req = (method: 'GET' | 'POST', path: string, owner: string, data?: unknown) =>
  setTestIdentity(new Request('http://localhost' + path, {
    method,
    headers: {'content-type': 'application/json'},
    body: data === undefined ? undefined : JSON.stringify(data),
  }), owner);
async function expectStatus(response: Response, status: number, label: string) {
  assert.equal(response.status, status, label + ': ' + JSON.stringify(await response.clone().json()));
}
const on = (id: string) => ({params: Promise.resolve({id})});
async function flow(owner: string) {
  const response = await getCashFlow(req('GET', '/api/finance/cash-flow?asOf=2026-11-22&from=2026-11-21&to=2026-11-22', owner));
  await expectStatus(response, 200, 'cash-flow projection');
  return await response.json() as {
    items: Array<{date: string; realizedIn: number; realizedOut: number; projectedIn: number; projectedOut: number}>;
    summary: {realizedIn: number; realizedOut: number; netRealized: number; projectedIn: number; projectedOut: number};
  };
}

after(async () => {
  try {
    const allActors = fixtures.map(f => f.owner);
    await pool.query('DELETE FROM finance_audit_events WHERE actor_id=ANY($1::text[])', [allActors]);
    await pool.query('DELETE FROM receivable_settlements WHERE receivable_id=ANY($1::text[])', [fixtures.map(f => f.receivable)]);
    await pool.query('DELETE FROM payable_payments WHERE payable_id=ANY($1::text[])', [fixtures.map(f => f.payable)]);
    await pool.query('DELETE FROM receivables WHERE id=ANY($1::text[])', [fixtures.map(f => f.receivable)]);
    await pool.query('DELETE FROM invoices WHERE id=ANY($1::text[])', [fixtures.map(f => f.invoice)]);
    await pool.query('DELETE FROM measurements WHERE id=ANY($1::text[])', [fixtures.map(f => f.measurement)]);
    await pool.query('DELETE FROM service_orders WHERE id=ANY($1::text[])', [fixtures.map(f => f.order)]);
    await pool.query('DELETE FROM payables WHERE id=ANY($1::text[])', [fixtures.map(f => f.payable)]);
  } finally {
    await closeDatabase();
    await pool.end();
  }
});

test('cash flow reversals subtract realized cash on their effective date without crossing owners', async () => {
  const now = new Date().toISOString();
  for (const f of fixtures) {
    await pool.query('INSERT INTO service_orders(id,owner_id,title,client,category,description,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [f.order, f.owner, 'Cash flow isolated test', 'CI', 'Serviços', 'CI', now]);
    await pool.query('INSERT INTO measurements(id,order_id,description,amount,status,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      [f.measurement, f.order, 'CI measurement', 100000, 'approved', now]);
    await pool.query('INSERT INTO invoices(id,measurement_id,order_id,amount,due_date,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      [f.invoice, f.measurement, f.order, 100000, '2026-11-22', now]);
    await pool.query('INSERT INTO receivables(id,invoice_id,amount,due_date,created_at) VALUES($1,$2,$3,$4,$5)',
      [f.receivable, f.invoice, 100000, '2026-11-22', now]);
    await pool.query('INSERT INTO payables(id,supplier,source_reference,description,amount,due_date,created_at,actor_id,request_hash,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [f.payable, 'Fornecedor CI', 'CI-PAY', 'Pagamento isolado', 80000, '2026-11-22', now, f.owner, randomUUID(), randomUUID()]);
  }
  const a = fixtures[0], b = fixtures[1];
  await expectStatus(await recordReceipt(req('POST','/api/finance/receivables/settlements',a.owner,{
    receivableId:a.receivable,amount:'60000',effectiveDate:'2026-11-21',reference:'CI original receipt',commandKey:keys[0],
  })), 201, 'owner A receipt');
  await expectStatus(await recordPayment(req('POST','/api/finance/payables/payments',a.owner,{
    payableId:a.payable,amount:'30000',effectiveDate:'2026-11-21',reference:'CI original payment',commandKey:keys[1],
  })), 201, 'owner A payment');
  await expectStatus(await recordReceipt(req('POST','/api/finance/receivables/settlements',b.owner,{
    receivableId:b.receivable,amount:'40000',effectiveDate:'2026-11-21',reference:'CI foreign receipt',commandKey:keys[2],
  })), 201, 'owner B receipt');
  await expectStatus(await recordPayment(req('POST','/api/finance/payables/payments',b.owner,{
    payableId:b.payable,amount:'20000',effectiveDate:'2026-11-21',reference:'CI foreign payment',commandKey:keys[3],
  })), 201, 'owner B payment');

  const before = await flow(a.owner);
  assert.equal(before.summary.realizedIn, 60000);
  assert.equal(before.summary.realizedOut, 30000);

  await expectStatus(await reverseReceipt(req('POST','/api/finance/receivables/settlements/'+keys[0]+'/reverse',a.owner,{
    commandKey:keys[4],effectiveDate:'2026-11-22',reference:'CI reversed receipt',
  }),on(keys[0])), 201, 'reverse receipt');
  await expectStatus(await reversePayment(req('POST','/api/finance/payables/payments/'+keys[1]+'/reverse',a.owner,{
    commandKey:keys[5],effectiveDate:'2026-11-22',reference:'CI reversed payment',
  }),on(keys[1])), 201, 'reverse payment');

  const resultA = await flow(a.owner), resultB = await flow(b.owner);
  const dayOne = resultA.items.find(item => item.date === '2026-11-21');
  const dayTwo = resultA.items.find(item => item.date === '2026-11-22');
  assert.ok(dayOne && dayTwo);
  assert.equal(dayOne.realizedIn, 60000);
  assert.equal(dayOne.realizedOut, 30000);
  assert.equal(dayTwo.realizedIn, -60000, 'Receipt reversal must be a negative realized entry');
  assert.equal(dayTwo.realizedOut, -30000, 'Payment reversal must be a negative realized exit');
  assert.equal(resultA.summary.realizedIn, 0);
  assert.equal(resultA.summary.realizedOut, 0);
  assert.equal(resultA.summary.netRealized, 0);
  assert.equal(resultA.summary.projectedIn, 100000, 'Reversed receivable returns to pending');
  assert.equal(resultA.summary.projectedOut, 80000, 'Reversed payable returns to pending');
  assert.equal(resultB.summary.realizedIn, 40000, 'Foreign receipts remain isolated');
  assert.equal(resultB.summary.realizedOut, 20000, 'Foreign payments remain isolated');

  const persisted = await pool.query(
    'SELECT kind,amount,reverses_id FROM receivable_settlements WHERE receivable_id=$1 ORDER BY effective_date',
    [a.receivable]);
  assert.deepEqual(persisted.rows.map(row => row.kind), ['receipt','reversal']);
  assert.equal(persisted.rows[1].reverses_id, keys[0]);
});
