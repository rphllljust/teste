import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { closeDatabase } from '../../db/raw';
import { setTestIdentity } from '../../lib/api/test-identity.mjs';
import { POST as submitApproval } from '../../app/api/workflow/approvals/route';
import { POST as decideApproval } from '../../app/api/workflow/approvals/[id]/commands/route';

if (process.env.NODE_ENV !== 'test') throw new Error('Integration harness must run with NODE_ENV=test');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for workflow business command integration tests');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const owner = randomUUID(), approver = randomUUID(), stranger = randomUUID();
const orderId = randomUUID(), approvalId = randomUUID();
const req = (path: string, identity: string, body: unknown) => setTestIdentity(new Request(`http://localhost${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), identity);
const json = async (response: Response) => response.clone().json() as Promise<Record<string, unknown>>;

after(async () => {
  await pool.query('DELETE FROM workflow_approval_events WHERE request_id=$1', [approvalId]);
  await pool.query('DELETE FROM order_events WHERE order_id=$1', [orderId]);
  await pool.query('DELETE FROM workflow_approval_requests WHERE id=$1', [approvalId]);
  await pool.query('DELETE FROM service_orders WHERE id=$1', [orderId]);
  await closeDatabase();
  await pool.end();
});

test('OS authorization approval controls the server transition with segregation and idempotency', async () => {
  const now = new Date().toISOString();
  await pool.query(`INSERT INTO service_orders(id,owner_id,title,client,category,description,status,version,created_at)
    VALUES($1,$2,'Workflow OS','Workflow Client','Serviços','Approval integration','draft',1,$3)`, [orderId, owner, now]);
  const body = { id: approvalId, entityType: 'service_order', entityId: orderId, command: 'authorize', expectedVersion: 1, approverId: approver, payload: { reason: 'Supervisor authorization' } };

  const submitted = await submitApproval(req('/api/workflow/approvals', owner, body));
  assert.equal(submitted.status, 201, JSON.stringify(await json(submitted.clone())));

  const unauthorized = await decideApproval(req(`/api/workflow/approvals/${approvalId}/commands`, stranger, { key: randomUUID(), version: 1, command: 'approve' }), { params: Promise.resolve({ id: approvalId }) });
  assert.equal(unauthorized.status, 403);

  const self = await decideApproval(req(`/api/workflow/approvals/${approvalId}/commands`, owner, { key: randomUUID(), version: 1, command: 'approve' }), { params: Promise.resolve({ id: approvalId }) });
  assert.equal(self.status, 403);

  const key = randomUUID();
  const approved = await decideApproval(req(`/api/workflow/approvals/${approvalId}/commands`, approver, { key, version: 1, command: 'approve' }), { params: Promise.resolve({ id: approvalId }) });
  assert.equal(approved.status, 200, JSON.stringify(await json(approved.clone())));
  assert.equal((await json(approved)).state, 'approved');

  const replay = await decideApproval(req(`/api/workflow/approvals/${approvalId}/commands`, approver, { key, version: 1, command: 'approve' }), { params: Promise.resolve({ id: approvalId }) });
  assert.equal(replay.status, 200);
  assert.equal((await json(replay)).replayed, true);

  const stored = await pool.query(`SELECT o.status,o.version,r.state,
    (SELECT count(*)::int FROM order_events WHERE order_id=$1 AND command='authorize') AS order_events
    FROM service_orders o JOIN workflow_approval_requests r ON r.entity_id=o.id
    WHERE o.id=$1 AND r.id=$2`, [orderId, approvalId]);
  assert.deepEqual(stored.rows[0], { status: 'authorized', version: 2, state: 'approved', order_events: 1 });
});
