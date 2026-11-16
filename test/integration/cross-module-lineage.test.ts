import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { closeDatabase } from '../../db/raw';
import { setTestIdentity } from '../../lib/api/test-identity.mjs';
import { GET as financeWorkspace } from '../../app/api/finance/workspace/route';

if (process.env.NODE_ENV !== 'test') throw new Error('Integration harness must run with NODE_ENV=test');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for integration tests');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const actor = randomUUID();
const orderId = randomUUID();
const measurementId = randomUUID();
const invoiceId = randomUUID();
const receivableId = randomUUID();

const request = (path: string) =>
  setTestIdentity(new Request('http://localhost' + path, { headers: { 'content-type': 'application/json' } }), actor);

before(async () => {
  const now = new Date().toISOString();
  await pool.query('BEGIN');
  try {
    await pool.query(
      'INSERT INTO service_orders(id,title,client,category,description,owner_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [orderId, 'UAT chain order', 'UAT synthetic client', 'Serviços', 'Cross-module integration evidence', actor, now],
    );
    await pool.query(
      'INSERT INTO measurements(id,order_id,description,amount,status,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      [measurementId, orderId, 'UAT approved measurement', 125000, 'approved', now],
    );
    await pool.query(
      'INSERT INTO invoices(id,measurement_id,order_id,amount,due_date,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      [invoiceId, measurementId, orderId, 125000, '2026-12-15', now],
    );
    await pool.query(
      'INSERT INTO receivables(id,invoice_id,amount,due_date,created_at) VALUES($1,$2,$3,$4,$5)',
      [receivableId, invoiceId, 125000, '2026-12-15', now],
    );
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
});

after(async () => {
  await pool.query('DELETE FROM receivable_settlements WHERE receivable_id=$1', [receivableId]);
  await pool.query('DELETE FROM receivables WHERE id=$1', [receivableId]);
  await pool.query('DELETE FROM invoices WHERE id=$1', [invoiceId]);
  await pool.query('DELETE FROM measurements WHERE id=$1', [measurementId]);
  await pool.query('DELETE FROM service_orders WHERE id=$1', [orderId]);
  await closeDatabase();
  await pool.end();
});

test('cross-module chain preserves OS, measurement, invoice and receivable lineage', async () => {
  const lineage = await pool.query(
    `SELECT so.id AS order_id, m.id AS measurement_id, i.id AS invoice_id, r.id AS receivable_id,
            m.status AS measurement_status, r.amount AS receivable_amount
       FROM service_orders so
       JOIN measurements m ON m.order_id=so.id
       JOIN invoices i ON i.measurement_id=m.id AND i.order_id=so.id
       JOIN receivables r ON r.invoice_id=i.id
      WHERE so.id=$1 AND so.owner_id=$2`,
    [orderId, actor],
  );
  assert.deepEqual(lineage.rows, [{
    order_id: orderId,
    measurement_id: measurementId,
    invoice_id: invoiceId,
    receivable_id: receivableId,
    measurement_status: 'approved',
    receivable_amount: 125000,
  }]);

  const response = await financeWorkspace(request('/api/finance/workspace'));
  assert.equal(response.status, 200, await response.text());
});
