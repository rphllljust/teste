import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { setTestIdentity } from '../../lib/api/test-identity.mjs';
import { closeDatabase } from '../../db/raw';
import { GET as getFinanceWorkspace } from '../../app/api/finance/workspace/route';

if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL)
  throw new Error('NO-GO: finance isolation requires disposable PostgreSQL');
const location = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(location.hostname) ||
    !['/cisne_test', '/cisne_ci'].includes(location.pathname) || location.port !== '5432')
  throw new Error('NO-GO: refusing finance test against a non-isolated database');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const ownerA = randomUUID(), ownerB = randomUUID();
const fixtures = [
  { order: randomUUID(), measurement: randomUUID(), invoice: randomUUID(), receivable: randomUUID(), owner: null, amount: 140000 },
  { order: randomUUID(), measurement: randomUUID(), invoice: randomUUID(), receivable: randomUUID(), owner: ownerA, amount: 200000 },
  { order: randomUUID(), measurement: randomUUID(), invoice: randomUUID(), receivable: randomUUID(), owner: ownerB, amount: 300000 },
];

async function metrics(actor: string) {
  const request = setTestIdentity(
    new Request('http://localhost/api/finance/workspace?asOf=2026-11-22'), actor);
  const response = await getFinanceWorkspace(request);
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const json = await response.json() as {
    metrics: Array<{ metricId: string; value: string; count: number }>;
  };
  const outstanding = json.metrics.find(m => m.metricId === 'receivables.outstanding');
  const overdue = json.metrics.find(m => m.metricId === 'receivables.overdue');
  assert.ok(outstanding && overdue, 'Both persisted receivable projections must exist');
  return { outstanding: { count: outstanding.count, value: Number(outstanding.value) },
    overdue: { count: overdue.count, value: Number(overdue.value) } };
}

after(async () => {
  try {
    await pool.query('DELETE FROM receivables WHERE id=ANY($1::text[])', [fixtures.map(f => f.receivable)]);
    await pool.query('DELETE FROM invoices WHERE id=ANY($1::text[])', [fixtures.map(f => f.invoice)]);
    await pool.query('DELETE FROM measurements WHERE id=ANY($1::text[])', [fixtures.map(f => f.measurement)]);
    await pool.query('DELETE FROM service_orders WHERE id=ANY($1::text[])', [fixtures.map(f => f.order)]);
  } finally {
    await closeDatabase();
    await pool.end();
  }
});

test('finance metrics never aggregate ownerless or foreign receivables', async () => {
  const beforeA = await metrics(ownerA), beforeB = await metrics(ownerB);
  const now = new Date().toISOString();
  for (const fixture of fixtures) {
    await pool.query(
      'INSERT INTO service_orders(id,owner_id,title,client,category,description,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [fixture.order, fixture.owner, 'Synthetic finance ownership check', 'CI', 'Serviços', 'Disposable owner-scope test', now],
    );
    await pool.query(
      'INSERT INTO measurements(id,order_id,description,amount,status,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      [fixture.measurement, fixture.order, 'Synthetic measurement', fixture.amount, 'approved', now],
    );
    await pool.query(
      'INSERT INTO invoices(id,measurement_id,order_id,amount,due_date,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      [fixture.invoice, fixture.measurement, fixture.order, fixture.amount, '2026-11-01', now],
    );
    await pool.query(
      'INSERT INTO receivables(id,invoice_id,amount,due_date,created_at) VALUES($1,$2,$3,$4,$5)',
      [fixture.receivable, fixture.invoice, fixture.amount, '2026-11-01', now],
    );
  }
  const afterA = await metrics(ownerA), afterB = await metrics(ownerB);
  for (const key of ['outstanding', 'overdue'] as const) {
    assert.equal(afterA[key].count - beforeA[key].count, 1, 'Owner A sees only own title');
    assert.equal(afterA[key].value - beforeA[key].value, 200000, 'Ownerless and B totals must be excluded');
    assert.equal(afterB[key].count - beforeB[key].count, 1, 'Owner B sees only own title');
    assert.equal(afterB[key].value - beforeB[key].value, 300000, 'Ownerless and A totals must be excluded');
  }
});
