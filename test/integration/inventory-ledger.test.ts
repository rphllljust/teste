import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { setTestIdentity } from '../../lib/api/test-identity.mjs';
import { closeDatabase } from '../../db/raw';
import { GET as getInventory, POST as inventoryCommand } from '../../app/api/inventory/route';

if (process.env.NODE_ENV !== 'test') throw new Error('Integration harness must run with NODE_ENV=test');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for inventory integration tests');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const req = (path: string, method: string, body: unknown, identity: string) => setTestIdentity(new Request(`http://localhost${path}`, {
 method,
 headers: { 'content-type': 'application/json' },
 body: JSON.stringify(body),
}), identity);
const json = async (response: Response) => response.clone().json() as Promise<Record<string, unknown>>;

async function clean(owner: string) {
 await pool.query('DELETE FROM inventory_consumption_events WHERE owner_id=$1', [owner]);
 await pool.query('DELETE FROM inventory_reservations WHERE owner_id=$1', [owner]);
 await pool.query('DELETE FROM inventory_movements WHERE owner_id=$1', [owner]);
 await pool.query('DELETE FROM inventory_items WHERE owner_id=$1', [owner]);
}

before(async () => {
 const result = await pool.query('SELECT current_schema() AS schema');
 assert.equal(result.rows[0].schema, 'public');
});

test('Inventory consumption atomically debits a reserved OS quantity and is owner-scoped/idempotent', async () => {
 const owner = randomUUID(), otherOwner = randomUUID(), itemId = randomUUID(), orderId = randomUUID(), reservationId = randomUUID();
 try {
  await pool.query(`INSERT INTO service_orders (id,owner_id,title,client,category,description,created_at,status,version)
    VALUES ($1,$2,'OS consumption','Synthetic client','Field','Inventory consumption test',now(),'executing',1)`, [orderId, owner]);
  assert.equal((await inventoryCommand(req('/api/inventory', 'POST', { type: 'create', id: itemId, sku: `CON-${itemId.slice(0, 8)}`, name: 'Consumable material', unit: 'un', minimum: '0' }, owner))).status, 201);
  assert.equal((await inventoryCommand(req('/api/inventory', 'POST', { type: 'move', id: randomUUID(), itemId, direction: 'in', quantity: '5', reference: 'Receipt for consumption', orderId: null }, owner))).status, 201);
  const reservation = { type: 'reserve', id: reservationId, itemId, sourceDocumentType: 'service-order', sourceDocumentId: orderId, quantity: '4', reference: 'Reserve for OS' };
  assert.equal((await inventoryCommand(req('/api/inventory', 'POST', reservation, owner))).status, 201);
  const consume = { type: 'consume', id: randomUUID(), itemId, orderId, reservationId, quantity: '2', reference: 'Consume on OS' };
  const first = await inventoryCommand(req('/api/inventory', 'POST', consume, owner));
  assert.equal(first.status, 201);
  assert.equal((await inventoryCommand(req('/api/inventory', 'POST', consume, owner))).status, 200);
  assert.equal((await inventoryCommand(req('/api/inventory', 'POST', { ...consume, id: randomUUID() }, otherOwner))).status, 404);
  const second = await inventoryCommand(req('/api/inventory', 'POST', { ...consume, id: randomUUID() }, owner));
  assert.equal(second.status, 201);
  assert.equal((await inventoryCommand(req('/api/inventory', 'POST', { ...consume, id: randomUUID(), quantity: '1' }, owner))).status, 409);
  const state = await pool.query(`SELECT r.status,r.quantity,r.consumed_quantity,
      (SELECT COALESCE(SUM(delta),0) FROM inventory_movements WHERE item_id=r.item_id AND owner_id=r.owner_id) AS balance,
      (SELECT COUNT(*) FROM inventory_consumption_events WHERE reservation_id=r.id) AS events
    FROM inventory_reservations r WHERE r.id=$1`, [reservationId]);
  assert.equal(state.rows[0].status, 'consumed');
  // Inventory quantities are persisted as thousandths to preserve decimal
  // precision; 4 units = 4000 and the remaining balance is 1 unit = 1000.
  assert.equal(Number(state.rows[0].quantity), 4000);
  assert.equal(Number(state.rows[0].consumed_quantity), 4000);
  assert.equal(Number(state.rows[0].balance), 1000);
  assert.equal(Number(state.rows[0].events), 2);
 } finally { await clean(owner); await clean(otherOwner); }
});
after(async () => { await closeDatabase(); await pool.end(); });

test('Inventory Ledger reservation is owner-scoped, idempotent, and protects availability under concurrency', async () => {
 const owner = randomUUID(), otherOwner = randomUUID(), itemId = randomUUID(), sourceId = randomUUID(), reservationId = randomUUID();
 try {
  assert.equal((await inventoryCommand(req('/api/inventory', 'POST', { type: 'create', id: itemId, sku: `RSV-${itemId.slice(0, 8)}`, name: 'Reservable material', unit: 'un', minimum: '0' }, owner))).status, 201);
  assert.equal((await inventoryCommand(req('/api/inventory', 'POST', { type: 'move', id: randomUUID(), itemId, direction: 'in', quantity: '10', reference: 'Reservation stock', orderId: null }, owner))).status, 201);
  const payload = { type: 'reserve', id: reservationId, itemId, sourceDocumentType: 'purchase-order', sourceDocumentId: sourceId, quantity: '7', reference: 'Reserve for source document' };
  assert.equal((await inventoryCommand(req('/api/inventory', 'POST', payload, owner))).status, 201);
  assert.equal((await inventoryCommand(req('/api/inventory', 'POST', payload, owner))).status, 200);
  assert.equal((await inventoryCommand(req('/api/inventory', 'POST', { ...payload, id: randomUUID() }, otherOwner))).status, 404);
  const concurrent = await Promise.all([
   inventoryCommand(req('/api/inventory', 'POST', { type: 'reserve', id: randomUUID(), itemId, sourceDocumentType: 'work-order', sourceDocumentId: randomUUID(), quantity: '3', reference: 'Concurrent reservation A' }, owner)),
   inventoryCommand(req('/api/inventory', 'POST', { type: 'reserve', id: randomUUID(), itemId, sourceDocumentType: 'work-order', sourceDocumentId: randomUUID(), quantity: '3', reference: 'Concurrent reservation B' }, owner)),
  ]);
  assert.deepEqual(concurrent.map(response => response.status).sort(), [201, 409]);
  const detailRequest = setTestIdentity(new Request(`http://localhost/api/inventory?item=${itemId}`, { method: 'GET' }), owner);
  const detail = await getInventory(detailRequest);
  assert.equal(detail.status, 200);
  const body = await json(detail) as { item: { balance: number; reserved: number; available: number }; reservations: unknown[] };
  assert.equal(Number(body.item.balance), 10000);
  assert.equal(Number(body.item.reserved), 10000);
  assert.equal(Number(body.item.available), 0);
  assert.equal(body.reservations.length, 2);
 } finally { await clean(owner); await clean(otherOwner); }
});
