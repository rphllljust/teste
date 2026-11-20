import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { closeDatabase } from '../../db/raw';
import { setTestIdentity } from '../../lib/api/test-identity.mjs';
import { POST as createOrder } from '../../app/api/orders/route';
import { POST as orderCommand } from '../../app/api/commands/route';

if (process.env.NODE_ENV !== 'test') throw new Error('Integration harness must run with NODE_ENV=test');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for handler integration tests');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const actor = () => randomUUID();
const req = (path: string, body: unknown, identity: string, headers: Record<string, string> = {}) =>
  setTestIdentity(new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }), identity);
const json = async (response: Response) => response.json() as Promise<Record<string, unknown>>;

async function clean(owner: string, orderId: string, clientId: string) {
  await pool.query('DELETE FROM order_events WHERE actor_id=$1 OR order_id=$2', [owner, orderId]);
  await pool.query('DELETE FROM service_orders WHERE id=$1 AND owner_id=$2', [orderId, owner]);
  await pool.query('DELETE FROM clients WHERE id=$1 AND owner_id=$2', [clientId, owner]);
}

before(async () => {
  const result = await pool.query('SELECT current_schema() AS schema');
  assert.equal(result.rows[0].schema, 'public');
});
after(async () => { await closeDatabase(); await pool.end(); });

test('Field Service start command enforces owner authorization, optimistic version, idempotency, and persisted transition', async () => {
  const owner = actor(), stranger = actor(), clientId = randomUUID(), orderId = randomUUID();
  try {
    const now = new Date().toISOString();
    await pool.query(
      'INSERT INTO clients(id,owner_id,legal_name,created_at,updated_at) VALUES($1,$2,$3,$4,$4)',
      [clientId, owner, 'CI Field Service Client', now],
    );
    const created = await createOrder(req('/api/orders', {
      id: orderId,
      title: 'CI start execution order',
      category: 'Serviços',
      description: 'Synthetic field execution invariant',
      dueDate: null,
      clientId,
      clientVersion: 1,
    }, owner));
    assert.equal(created.status, 201);

    const authorize = { id: orderId, version: 1, key: randomUUID(), command: 'authorize' as const };
    assert.equal((await orderCommand(req('/api/commands', authorize, owner))).status, 201);

    const start = { id: orderId, version: 2, key: randomUUID(), command: 'start' as const };
    const correlationHeaders = { 'x-correlation-id': 'field-start-ci-001' };
    const started = await orderCommand(req('/api/commands', start, owner, correlationHeaders));
    const startedBody = await json(started) as unknown as { resource: { rowVersion: number } };
    assert.equal(started.status, 201, JSON.stringify(startedBody));
    assert.equal(startedBody.resource.rowVersion, 3);

    const replay = await orderCommand(req('/api/commands', start, owner, correlationHeaders));
    assert.equal(replay.status, 200);
    assert.deepEqual(await json(replay), startedBody);

    const stale = await orderCommand(req('/api/commands', {
      id: orderId, version: 2, key: randomUUID(), command: 'complete',
    }, owner));
    assert.equal(stale.status, 409);

    const foreign = await orderCommand(req('/api/commands', {
      id: orderId, version: 3, key: randomUUID(), command: 'complete',
    }, stranger));
    assert.equal(foreign.status, 404);

    const stored = await pool.query(
      `SELECT status,version,
        (SELECT count(*)::int FROM order_events WHERE order_id=$1 AND command='start') AS start_events
       FROM service_orders WHERE id=$1 AND owner_id=$2`,
      [orderId, owner],
    );
    assert.deepEqual(stored.rows[0], { status: 'executing', version: 3, start_events: 1 });
  } finally {
    await clean(owner, orderId, clientId);
  }
});
