import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { setTestIdentity } from '../../lib/api/test-identity.mjs';
import { database, closeDatabase } from '../../db/raw';
import { GET as getOrders, POST as createOrder } from '../../app/api/orders/route';
import { GET as getInventory, POST as inventoryCommand } from '../../app/api/inventory/route';
import { GET as getProcurement, POST as procurementCommand } from '../../app/api/procurement/route';
import { GET as getMrp, POST as runMrp } from '../../app/api/mrp/route';
import { POST as mrpCommand } from '../../app/api/mrp/commands/route';

if (process.env.NODE_ENV !== 'test') throw new Error('Integration harness must run with NODE_ENV=test');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for handler integration tests');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
type OrderResponse = { items: Array<{ id: string }> };
type ProcurementResponse = { items: Array<{ id: string }> };
type MrpResponse = { recommendations: Array<{ recommendationId: string; materialId: string; rowVersion: number }> };
const actor = () => randomUUID();
const req = (path: string, method: string, body?: unknown, identity?: string, headers: Record<string,string> = {}) => {
  const request = new Request(`http://localhost${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return identity ? setTestIdentity(request, identity) : request;
};
const json = async (response: Response) => response.json() as Promise<Record<string, unknown>>;

async function clean(owner: string) {
  await pool.query('DELETE FROM mrp_events WHERE owner_id=$1', [owner]);
  await pool.query('DELETE FROM mrp_recommendations WHERE owner_id=$1', [owner]);
  await pool.query('DELETE FROM mrp_runs WHERE owner_id=$1', [owner]);
  await pool.query('DELETE FROM procurement_commands WHERE actor_id=$1', [owner]);
  await pool.query('DELETE FROM procurement_receipt_lines WHERE receipt_id IN (SELECT id FROM procurement_receipts WHERE owner_id=$1)', [owner]);
  await pool.query('DELETE FROM procurement_receipts WHERE owner_id=$1', [owner]);
  await pool.query('DELETE FROM supplier_purchase_order_lines WHERE owner_id=$1', [owner]);
  await pool.query('DELETE FROM supplier_purchase_orders WHERE owner_id=$1', [owner]);
  await pool.query('DELETE FROM suppliers WHERE owner_id=$1', [owner]);
  await pool.query('DELETE FROM inventory_movements WHERE owner_id=$1', [owner]);
  await pool.query('DELETE FROM inventory_items WHERE owner_id=$1', [owner]);
  await pool.query('DELETE FROM order_events WHERE actor_id=$1', [owner]);
  await pool.query('DELETE FROM service_orders WHERE owner_id=$1', [owner]);
  await pool.query('DELETE FROM clients WHERE owner_id=$1', [owner]);
}

before(async () => {
  const result = await pool.query('SELECT current_database() AS database, current_schema() AS schema');
  assert.equal(result.rows[0].schema, 'public');
});
after(async () => { await closeDatabase(); await pool.end(); });

test('public staging handlers reject forged identities and secrets, including writes', async () => {
  const prior = process.env.RAILWAY_ENVIRONMENT_NAME;
  const priorSecret = process.env.CISNE_TRUSTED_DISPATCH_SECRET;
  process.env.RAILWAY_ENVIRONMENT_NAME = 'staging';
  process.env.CISNE_TRUSTED_DISPATCH_SECRET = 'integration-only-secret';
  try {
    const anonymous = await getOrders(req('/api/orders', 'GET'));
    assert.equal(anonymous.status, 403);
    const forgedRead = await getOrders(req('/api/orders', 'GET', undefined, undefined, { 'oai-authenticated-user-id': 'forged' }));
    assert.equal(forgedRead.status, 403);
    const anonymousWrite = await inventoryCommand(req('/api/inventory', 'POST', { type: 'create', id: randomUUID(), sku: 'FORGED', name: 'Forged', unit: 'un', minimum: '0' }));
    assert.equal(anonymousWrite.status, 403);
    const forgedWrite = await inventoryCommand(req('/api/inventory', 'POST', { type: 'create', id: randomUUID(), sku: 'FORGED', name: 'Forged', unit: 'un', minimum: '0' }, undefined, { 'x-cisne-dispatch-secret': process.env.CISNE_TRUSTED_DISPATCH_SECRET!, 'oai-authenticated-user-id': 'forged' }));
    assert.equal(forgedWrite.status, 403);
  } finally {
    if (prior === undefined) delete process.env.RAILWAY_ENVIRONMENT_NAME;
    else process.env.RAILWAY_ENVIRONMENT_NAME = prior;
    if (priorSecret === undefined) delete process.env.CISNE_TRUSTED_DISPATCH_SECRET;
    else process.env.CISNE_TRUSTED_DISPATCH_SECRET = priorSecret;
  }
});

test('order handler creates and lists a persisted order; invalid input is rejected', async () => {
  const owner = actor(), clientId = randomUUID(), orderId = randomUUID(), now = new Date().toISOString();
  try {
    await pool.query('INSERT INTO clients(id,owner_id,legal_name,created_at,updated_at) VALUES($1,$2,$3,$4,$4)', [clientId, owner, 'CI Client', now]);
    const bad = await createOrder(req('/api/orders', 'POST', { id: randomUUID(), title: 'x' }, owner));
    assert.equal(bad.status, 400);
    const staleClient = await createOrder(req('/api/orders', 'POST', { id: randomUUID(), title: 'Stale client order', category: 'Serviços', description: 'synthetic test', dueDate: null, clientId, clientVersion: 2 }, owner));
    assert.equal(staleClient.status, 409);
    const created = await createOrder(req('/api/orders', 'POST', { id: orderId, title: 'CI integration order', category: 'Serviços', description: 'synthetic test', dueDate: null, clientId, clientVersion: 1 }, owner));
    assert.equal(created.status, 201, JSON.stringify(await json(created.clone())));
    const stored = await pool.query('SELECT title,status,version FROM service_orders WHERE id=$1 AND owner_id=$2', [orderId, owner]);
    assert.equal(stored.rows[0]?.title, 'CI integration order');
    const listed = await getOrders(req('/api/orders?q=integration', 'GET', undefined, owner));
    assert.equal(listed.status, 200);
    assert.ok(((await json(listed)) as unknown as OrderResponse).items.some(row => row.id === orderId));
  } finally { await clean(owner); }
});

test('inventory handler persists receipts/issues, rejects overdraft, and reports the real balance', async () => {
  const owner = actor(), itemId = randomUUID();
  try {
    const created = await inventoryCommand(req('/api/inventory', 'POST', { type: 'create', id: itemId, sku: `CI-${itemId.slice(0,8)}`, name: 'CI material', unit: 'un', minimum: '1' }, owner));
    assert.equal(created.status, 201);
    const receipt = await inventoryCommand(req('/api/inventory', 'POST', { type: 'move', id: randomUUID(), itemId, direction: 'in', quantity: '5', reference: 'CI receipt', orderId: null }, owner));
    assert.equal(receipt.status, 201);
    const issue = await inventoryCommand(req('/api/inventory', 'POST', { type: 'move', id: randomUUID(), itemId, direction: 'out', quantity: '2', reference: 'CI issue', orderId: null }, owner));
    assert.equal(issue.status, 201);
    const overdraft = await inventoryCommand(req('/api/inventory', 'POST', { type: 'move', id: randomUUID(), itemId, direction: 'out', quantity: '9', reference: 'CI overdraft', orderId: null }, owner));
    assert.equal(overdraft.status, 409);
    const detail = await getInventory(req(`/api/inventory?item=${itemId}`, 'GET', undefined, owner));
    assert.equal(detail.status, 200);
    assert.equal(Number(((await json(detail)).item as { balance: number }).balance), 3000);
    const stored = await pool.query('SELECT SUM(delta)::int AS balance,COUNT(*)::int AS movements FROM inventory_movements WHERE item_id=$1 AND owner_id=$2', [itemId, owner]);
    assert.deepEqual(stored.rows[0], { balance: 3000, movements: 2 });
    const concurrent = await Promise.all([
      inventoryCommand(req('/api/inventory', 'POST', { type: 'move', id: randomUUID(), itemId, direction: 'out', quantity: '2', reference: 'Concurrent issue A', orderId: null }, owner)),
      inventoryCommand(req('/api/inventory', 'POST', { type: 'move', id: randomUUID(), itemId, direction: 'out', quantity: '2', reference: 'Concurrent issue B', orderId: null }, owner)),
    ]);
    assert.deepEqual(concurrent.map(response => response.status).sort(), [201, 409]);
    const afterRace = await pool.query('SELECT SUM(delta)::int AS balance,COUNT(*)::int AS movements FROM inventory_movements WHERE item_id=$1 AND owner_id=$2', [itemId, owner]);
    assert.deepEqual(afterRace.rows[0], { balance: 1000, movements: 3 });
  } finally { await clean(owner); }
});

test('procurement handler persists supplier/order/lines with linked inventory', async () => {
  const owner=actor(), supplierId=randomUUID(), itemId=randomUUID(), orderId=randomUUID(), lineId=randomUUID();
  try {
    const item = await inventoryCommand(req('/api/inventory','POST',{type:'create',id:itemId,sku:`PO-${itemId.slice(0,8)}`,name:'CI procurement item',unit:'un',minimum:'0'},owner));
    assert.equal(item.status,201);
    const supplier = await procurementCommand(req('/api/procurement','POST',{type:'supplier',id:supplierId,legalName:'CI Supplier',document:`CI-${supplierId}`,email:''},owner));
    assert.equal(supplier.status,201,JSON.stringify(await json(supplier.clone())));
    const invalidOrder = await procurementCommand(req('/api/procurement','POST',{type:'order',id:randomUUID(),supplierId,reference:'missing lines',expectedOn:'2027-01-15'},owner));
    assert.equal(invalidOrder.status,400);
    const order = await procurementCommand(req('/api/procurement','POST',{type:'order',id:orderId,supplierId,reference:`CI-${orderId.slice(0,8)}`,expectedOn:'2027-01-15',lines:[{id:lineId,itemId,quantity:'3',unitPrice:'12.50'}]},owner));
    assert.equal(order.status,201,JSON.stringify(await json(order.clone())));
    const list = await getProcurement(req('/api/procurement?q=CI-', 'GET', undefined, owner));
    assert.equal(list.status,200);
    assert.ok(((await json(list)) as unknown as ProcurementResponse).items.some(row=>row.id===orderId));
    const stored=await pool.query('SELECT p.status,p.total,l.quantity,l.subtotal FROM supplier_purchase_orders p JOIN supplier_purchase_order_lines l ON l.order_id=p.id WHERE p.id=$1 AND p.owner_id=$2',[orderId,owner]);
    assert.equal(stored.rows[0]?.status,'draft');
    assert.equal(Number(stored.rows[0]?.quantity),3000);
    assert.equal(Number(stored.rows[0]?.subtotal),375000);
  } finally { await clean(owner); }
});

test('MRP runs against persisted stock, approval is versioned, and converts to a real purchase order', async () => {
  const owner=actor(), itemId=randomUUID(), supplierId=randomUUID(), now=new Date().toISOString();
  try {
    const item=await inventoryCommand(req('/api/inventory','POST',{type:'create',id:itemId,sku:`MRP-${itemId.slice(0,8)}`,name:'CI MRP material',unit:'un',minimum:'5'},owner));
    assert.equal(item.status,201);
    const supplier=await procurementCommand(req('/api/procurement','POST',{type:'supplier',id:supplierId,legalName:'CI MRP Supplier',document:`MRP-${supplierId}`,email:''},owner));
    assert.equal(supplier.status,201);
    const run=await runMrp(req('/api/mrp','POST',{horizonDays:30},owner));
    assert.equal(run.status,201,JSON.stringify(await json(run.clone())));
    const runBody=await json(run);
    assert.equal(runBody.evaluatedMaterials,1);
    assert.equal(runBody.shortages,1);
    const recommendations=await getMrp(req('/api/mrp','GET',undefined,owner));
    const recommendation=((await json(recommendations)) as unknown as MrpResponse).recommendations[0];
    assert.equal(recommendation.materialId,itemId);
    const approve=await mrpCommand(req('/api/mrp/commands','POST',{recommendationId:recommendation.recommendationId,expectedVersion:1,command:'approve'},owner));
    assert.equal(approve.status,200,JSON.stringify(await json(approve.clone())));
    const invalidSupplier=await mrpCommand(req('/api/mrp/commands','POST',{recommendationId:recommendation.recommendationId,expectedVersion:2,command:'convert',purchaseOrderId:randomUUID(),lineId:randomUUID(),supplierId:randomUUID(),reference:`MRP-${randomUUID().slice(0,8)}`,expectedOn:'2027-01-15',unitPrice:'10.00'},owner));
    assert.equal(invalidSupplier.status,409);
    const converted=await mrpCommand(req('/api/mrp/commands','POST',{recommendationId:recommendation.recommendationId,expectedVersion:2,command:'convert',purchaseOrderId:randomUUID(),lineId:randomUUID(),supplierId,reference:`MRP-${randomUUID().slice(0,8)}`,expectedOn:'2027-01-15',unitPrice:'10.00'},owner));
    assert.equal(converted.status,201,JSON.stringify(await json(converted.clone())));
    const persisted=await pool.query(`SELECT r.status,r.row_version,p.status AS po_status,l.quantity
      FROM mrp_recommendations r JOIN supplier_purchase_orders p ON p.id=r.purchase_order_id
      JOIN supplier_purchase_order_lines l ON l.order_id=p.id WHERE r.id=$1 AND r.owner_id=$2`,[recommendation.recommendationId,owner]);
    assert.equal(persisted.rows[0]?.status,'converted');
    assert.equal(Number(persisted.rows[0]?.row_version),3);
    assert.equal(persisted.rows[0]?.po_status,'draft');
    assert.equal(Number(persisted.rows[0]?.quantity),5000);
    assert.ok(now);
  } finally { await clean(owner); }
});

test('PostgreSQL batch rollback leaves no partial handler-adapter write', async () => {
  const owner=actor(), itemId=randomUUID();
  try {
    await assert.rejects(database().batch([
      database().prepare('INSERT INTO inventory_items(id,owner_id,sku,name,unit,minimum,created_at,request_hash) VALUES(?,?,?,?,?,?,?,?)').bind(itemId,owner,`RB-${itemId.slice(0,8)}`,'rollback item','un',0,new Date().toISOString(),'rollback'),
      database().prepare('INSERT INTO table_that_does_not_exist(id) VALUES(?)').bind(randomUUID()),
    ]));
    const result=await pool.query('SELECT count(*)::int AS count FROM inventory_items WHERE id=$1',[itemId]);
    assert.equal(result.rows[0].count,0);
  } finally { await clean(owner); }
});
