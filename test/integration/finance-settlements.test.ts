import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { setTestIdentity } from '../../lib/api/test-identity.mjs';
import { closeDatabase } from '../../db/raw';
import { POST as settle } from '../../app/api/finance/receivables/settlements/route';
import { POST as reverse } from '../../app/api/finance/receivables/settlements/[id]/reverse/route';
import { POST as closePeriod } from '../../app/api/finance/periods/close/route';
import { GET as listClosedPeriods } from '../../app/api/finance/periods/close/route';

if (process.env.NODE_ENV !== 'test') throw new Error('Integration harness must run with NODE_ENV=test');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for finance integration tests');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const actor = randomUUID();
const invoiceId = randomUUID();
const receivableId = randomUUID();
const measurementId = randomUUID();
const orderId = randomUUID();
const req = (path: string, method: string, body: unknown) => setTestIdentity(new Request(`http://localhost${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), actor);
const json = async (response: Response) => response.clone().json() as Promise<Record<string, unknown>>;

before(async () => {
  const now = new Date().toISOString();
  await pool.query('INSERT INTO service_orders(id,title,client,category,description,created_at) VALUES($1,$2,$3,$4,$5,$6)', [orderId, 'Finance integration order', 'Finance CI', 'Serviços', 'Finance CI', now]);
  await pool.query('INSERT INTO measurements(id,order_id,description,amount,status,created_at) VALUES($1,$2,$3,$4,$5,$6)', [measurementId, orderId, 'Finance CI measurement', 10000, 'approved', now]);
  await pool.query('INSERT INTO invoices(id,measurement_id,order_id,amount,due_date,created_at) VALUES($1,$2,$3,$4,$5,$6)', [invoiceId, measurementId, orderId, 10000, '2026-12-01', now]);
  await pool.query('INSERT INTO receivables(id,invoice_id,amount,due_date,created_at) VALUES($1,$2,$3,$4,$5)', [receivableId, invoiceId, 10000, '2026-12-01', now]);
});

after(async () => {
  await pool.query('DELETE FROM finance_period_closes WHERE actor_id=$1', [actor]);
  await pool.query('DELETE FROM finance_audit_events WHERE actor_id=$1', [actor]);
  await pool.query('DELETE FROM receivable_settlements WHERE receivable_id=$1', [receivableId]);
  await pool.query('DELETE FROM receivables WHERE id=$1', [receivableId]);
  await pool.query('DELETE FROM invoices WHERE id=$1', [invoiceId]);
  await pool.query('DELETE FROM measurements WHERE id=$1', [measurementId]);
  await pool.query('DELETE FROM service_orders WHERE id=$1', [orderId]);
  await closeDatabase();
  await pool.end();
});

test('receivable settlement is idempotent, concurrent-safe by lock, and reversable', async () => {
  const commandKey = randomUUID();
  const first = await settle(req('/api/finance/receivables/settlements', 'POST', { receivableId, amount: '4000', effectiveDate: '2026-11-16', reference: 'CI receipt', commandKey }));
  assert.equal(first.status, 201, JSON.stringify(await json(first.clone())));
  const replay = await settle(req('/api/finance/receivables/settlements', 'POST', { receivableId, amount: '4000', effectiveDate: '2026-11-16', reference: 'CI receipt', commandKey }));
  assert.equal(replay.status, 200);
  const excessive = await settle(req('/api/finance/receivables/settlements', 'POST', { receivableId, amount: '7000', effectiveDate: '2026-11-16', reference: 'CI excessive', commandKey: randomUUID() }));
  assert.equal(excessive.status, 409);
  const reversalKey = randomUUID();
  const reversed = await reverse(req(`/api/finance/receivables/settlements/${commandKey}/reverse`, 'POST', { commandKey: reversalKey, effectiveDate: '2026-11-17', reference: 'CI reversal' }), { params: Promise.resolve({ id: commandKey }) });
  assert.equal(reversed.status, 201, JSON.stringify(await json(reversed.clone())));
  const duplicate = await reverse(req(`/api/finance/receivables/settlements/${commandKey}/reverse`, 'POST', { commandKey: randomUUID(), effectiveDate: '2026-11-17', reference: 'CI duplicate reversal' }), { params: Promise.resolve({ id: commandKey }) });
  assert.equal(duplicate.status, 409);
  const stored = await pool.query("SELECT kind,amount,reverses_id FROM receivable_settlements WHERE receivable_id=$1 ORDER BY kind", [receivableId]);
  assert.deepEqual(stored.rows, [{ kind: 'receipt', amount: 4000, reverses_id: null }, { kind: 'reversal', amount: 4000, reverses_id: commandKey }]);
  const audit = await pool.query("SELECT action,entity_type,entity_id,actor_id FROM finance_audit_events WHERE entity_id=$1 ORDER BY occurred_at, id", [receivableId]);
  assert.deepEqual(audit.rows, [{ action: 'receipt_registered', entity_type: 'receivable', entity_id: receivableId, actor_id: actor }, { action: 'receipt_reversed', entity_type: 'receivable', entity_id: receivableId, actor_id: actor }]);
  const periodId = randomUUID();
  const closed = await closePeriod(req('/api/finance/periods/close', 'POST', { id: periodId, periodStart: '2026-11-01', periodEnd: '2026-11-30', reference: 'CI close' }));
  assert.equal(closed.status, 201);
  const listed = await listClosedPeriods(req('/api/finance/periods/close', 'GET', {}));
  assert.equal(listed.status, 200);
  assert.equal(((await json(listed)) as { items: Array<{ id: string }> }).items[0].id, periodId);
  const blocked = await settle(req('/api/finance/receivables/settlements', 'POST', { receivableId, amount: '1000', effectiveDate: '2026-11-20', reference: 'CI blocked', commandKey: randomUUID() }));
  assert.equal(blocked.status, 409);
});
