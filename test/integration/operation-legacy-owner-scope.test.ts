import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { closeDatabase } from '../../db/raw';
import { setTestIdentity } from '../../lib/api/test-identity.mjs';
import { GET as listOperation } from '../../app/api/operation/route';
import { GET as detailOperation } from '../../app/api/operation/[kind]/[id]/route';
import { POST as executeCommand } from '../../app/api/commands/route';

if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL)
  throw new Error('NO-GO: operation owner test requires isolated PostgreSQL');
const target = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(target.hostname) ||
    target.port !== '5432' || !['/cisne_ci', '/cisne_test'].includes(target.pathname))
  throw new Error('NO-GO: refusing operation owner test on non-isolated database');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const alice = randomUUID(), bob = randomUUID();
const fixtures = [
  { owner: null, order: randomUUID(), measurement: randomUUID(), invoice: randomUUID(), receivable: randomUUID() },
  { owner: alice, order: randomUUID(), measurement: randomUUID(), invoice: randomUUID(), receivable: randomUUID() },
  { owner: bob, order: randomUUID(), measurement: randomUUID(), invoice: randomUUID(), receivable: randomUUID() },
];
const request = (actor: string, path: string) =>
  setTestIdentity(new Request('http://localhost' + path), actor);
const cases = [
  { kind: 'measurements', field: 'measurement' },
  { kind: 'invoices', field: 'invoice' },
  { kind: 'receivables', field: 'receivable' },
] as const;

async function list(actor: string, kind: string) {
  const response = await listOperation(request(actor, '/api/operation?kind=' + kind));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const data = await response.json() as {
    pageInfo: { sourceTotal: number; total: number };
    measurements: Array<{ id: string }>; invoices: Array<{ id: string }>; receivables: Array<{ id: string }>;
  };
  return { sourceTotal: data.pageInfo.sourceTotal,
    ids: (data[kind as keyof Pick<typeof data, 'measurements'|'invoices'|'receivables'>] as Array<{ id: string }>).map(item => item.id) };
}
async function detail(actor: string, kind: string, id: string) {
  return detailOperation(request(actor, '/api/operation/' + kind + '/' + id),
    { params: Promise.resolve({ kind, id }) });
}

test('operation List Reports and deep links deny ownerless and foreign financial records', async () => {
  const before = new Map<string, number>();
  try {
    for (const actor of [alice, bob])
      for (const {kind} of cases) before.set(actor + ':' + kind, (await list(actor, kind)).sourceTotal);
    const now = new Date().toISOString();
    for (const row of fixtures) {
      await pool.query(
        'INSERT INTO service_orders(id,owner_id,title,client,category,description,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [row.order, row.owner, 'CI owner isolation', 'CI', 'Serviços', 'Disposable fixture', now]);
      await pool.query(
        'INSERT INTO measurements(id,order_id,description,amount,status,created_at) VALUES($1,$2,$3,$4,$5,$6)',
        [row.measurement, row.order, 'CI measurement', 150000, 'approved', now]);
      await pool.query(
        'INSERT INTO invoices(id,measurement_id,order_id,amount,due_date,created_at) VALUES($1,$2,$3,$4,$5,$6)',
        [row.invoice, row.measurement, row.order, 150000, '2026-11-01', now]);
      await pool.query(
        'INSERT INTO receivables(id,invoice_id,amount,due_date,created_at) VALUES($1,$2,$3,$4,$5)',
        [row.receivable, row.invoice, 150000, '2026-11-01', now]);
    }
    for (const actor of [alice, bob]) {
      const own = fixtures.find(row => row.owner === actor)!;
      for (const {kind, field} of cases) {
        const result = await list(actor, kind);
        assert.equal(result.sourceTotal - before.get(actor + ':' + kind)!, 1,
          kind + ' source count must exclude ownerless and foreign records');
        assert.ok(result.ids.includes(own[field]), 'Owned record must be present in List Report');
        for (const foreign of fixtures.filter(row => row.owner !== actor)) {
          assert.equal(result.ids.includes(foreign[field]), false, 'Foreign record hidden in list');
          const denied = await detail(actor, kind, foreign[field]);
          assert.equal(denied.status, 404, kind + ' deep link cannot expose foreign or unowned record');
        }
        const allowed = await detail(actor, kind, own[field]);
        assert.equal(allowed.status, 200, kind + ' deep link remains available to owner');
      }
    }
    // A legacy measurement without owner must never be approved or invoiced via the
    // generic command endpoint, even when its UUID is known to the authenticated actor.
    for (const actor of [alice, bob]) {
      for (const command of ['approve_measurement', 'invoice'] as const) {
        const payload = {
          id: fixtures[0].measurement,
          version: 1,
          key: randomUUID(),
          command,
          ...(command === 'invoice' ? { dueDate: '2026-12-15' } : {}),
        };
        const response = await executeCommand(setTestIdentity(
          new Request('http://localhost/api/commands', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          }), actor));
        assert.equal(response.status, 404, 'Legacy ownerless measurement must reject ' + command);
      }
    }
  } finally {
    await pool.query('DELETE FROM receivables WHERE id=ANY($1::text[])', [fixtures.map(row => row.receivable)]);
    await pool.query('DELETE FROM invoices WHERE id=ANY($1::text[])', [fixtures.map(row => row.invoice)]);
    await pool.query('DELETE FROM measurements WHERE id=ANY($1::text[])', [fixtures.map(row => row.measurement)]);
    await pool.query('DELETE FROM service_orders WHERE id=ANY($1::text[])', [fixtures.map(row => row.order)]);
    await closeDatabase();
    await pool.end();
  }
});
