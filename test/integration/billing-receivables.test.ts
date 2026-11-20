import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { closeDatabase } from '../../db/raw';
import { setTestIdentity } from '../../lib/api/test-identity.mjs';
import { POST as generateBilling } from '../../app/api/finance/billing/route';

if (process.env.NODE_ENV !== 'test') throw new Error('Integration harness must run with NODE_ENV=test');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for billing integration tests');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const actor = randomUUID();
const orderId = randomUUID();
const rejectedMeasurementId = randomUUID();
const approvedMeasurementId = randomUUID();
const req = (body: unknown) => setTestIdentity(new Request('http://localhost/api/finance/billing', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}), actor);
type BillingResponse = { resource: { invoiceId: string; receivableId: string } };
const json = async (response: Response) => response.clone().json() as Promise<BillingResponse>;

before(async () => {
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO service_orders(id,owner_id,title,client,category,description,status,version,created_at)
     VALUES($1,$2,'Billing CI order','Billing CI','Serviços','Billing source','completed',1,$3)`,
    [orderId, actor, now],
  );
  await pool.query(
    `INSERT INTO measurements(id,order_id,description,amount,status,version,created_at)
     VALUES($1,$3,'Rejected billing measurement',1000,'draft',1,$2),($4,$3,'Approved billing measurement',25000,'approved',2,$2)`,
    [rejectedMeasurementId, now, orderId, approvedMeasurementId],
  );
});

after(async () => {
  await pool.query('DELETE FROM finance_audit_events WHERE entity_id=$1', [approvedMeasurementId]);
  await pool.query('DELETE FROM order_events WHERE order_id=$1', [orderId]);
  await pool.query('DELETE FROM receivables WHERE invoice_id IN (SELECT id FROM invoices WHERE measurement_id=$1)', [approvedMeasurementId]);
  await pool.query('DELETE FROM invoices WHERE measurement_id=$1', [approvedMeasurementId]);
  await pool.query('DELETE FROM measurements WHERE order_id=$1', [orderId]);
  await pool.query('DELETE FROM service_orders WHERE id=$1', [orderId]);
  await closeDatabase();
  await pool.end();
});

test('billing only accepts approved measurements and is idempotent under concurrent retry', async () => {
  const rejected = await generateBilling(req({ measurementId: rejectedMeasurementId, dueDate: '2026-12-20', commandKey: randomUUID() }));
  assert.equal(rejected.status, 409);
  assert.equal((await pool.query('SELECT status FROM measurements WHERE id=$1', [rejectedMeasurementId])).rows[0].status, 'draft');

  const commandKey = randomUUID();
  const payload = { measurementId: approvedMeasurementId, dueDate: '2026-12-20', commandKey };
  const responses = await Promise.all([generateBilling(req(payload)), generateBilling(req(payload))]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 201]);
  const firstBody = await json(responses.find(response => response.status === 201)!);
  const replayBody = await json(responses.find(response => response.status === 200)!);
  assert.equal(firstBody.resource.invoiceId, replayBody.resource.invoiceId);
  assert.equal(firstBody.resource.receivableId, replayBody.resource.receivableId);

  const duplicate = await generateBilling(req({ ...payload, commandKey: randomUUID() }));
  assert.equal(duplicate.status, 409);

  const stored = await pool.query(
    `SELECT m.status,m.version,
      (SELECT count(*)::int FROM invoices WHERE measurement_id=m.id) AS invoices,
      (SELECT count(*)::int FROM receivables r JOIN invoices i ON i.id=r.invoice_id WHERE i.measurement_id=m.id) AS receivables,
      (SELECT count(*)::int FROM finance_audit_events WHERE entity_type='measurement' AND entity_id=m.id AND action='billing_generated') AS audits
     FROM measurements m WHERE m.id=$1`,
    [approvedMeasurementId],
  );
  assert.deepEqual(stored.rows[0], { status: 'billed', version: 3, invoices: 1, receivables: 1, audits: 1 });
});
