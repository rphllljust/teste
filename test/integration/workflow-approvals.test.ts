import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { setTestIdentity } from '../../lib/api/test-identity.mjs';
import { closeDatabase } from '../../db/raw';
import { POST as submitApproval } from '../../app/api/workflow/approvals/route';
import { POST as decideApproval } from '../../app/api/workflow/approvals/[id]/commands/route';

if (process.env.NODE_ENV !== 'test') throw new Error('Integration harness must run with NODE_ENV=test');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for workflow approval integration tests');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const requester = randomUUID();
const approver = randomUUID();
const stranger = randomUUID();
const approvalId = randomUUID();
const entityId = randomUUID();

function req(path: string, method: string, identity: string, body: unknown) {
  return setTestIdentity(new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), identity);
}

const params = { params: Promise.resolve({ id: approvalId }) };
const json = async (response: Response) => response.clone().json() as Promise<Record<string, unknown>>;

after(async () => {
  await pool.query('DELETE FROM finance_audit_events WHERE entity_type=$1 AND entity_id=$2', ['finance_period',entityId]);
  await pool.query('DELETE FROM finance_period_closes WHERE id=$1', [entityId]);
  await pool.query('DELETE FROM workflow_approval_events WHERE request_id=$1', [approvalId]);
  await pool.query('DELETE FROM workflow_approval_requests WHERE id=$1', [approvalId]);
  await closeDatabase();
  await pool.end();
});

test('finance approval is server-authoritative, segregated, versioned, audited and idempotent', async () => {
  const payload = {
    id: approvalId,
    entityType: 'finance_period_close',
    entityId,
    command: 'close',
    expectedVersion: 1,
    approverId: approver,
    payload: { periodStart: '2026-11-01', periodEnd: '2026-11-30', reference: 'CI approval' },
  };

  const selfApproval = await submitApproval(req('/api/workflow/approvals', 'POST', requester, { ...payload, approverId: requester }));
  assert.equal(selfApproval.status, 409);

  const submitted = await submitApproval(req('/api/workflow/approvals', 'POST', requester, payload));
  assert.equal(submitted.status, 201, JSON.stringify(await json(submitted.clone())));
  assert.deepEqual((await json(submitted)).state, 'pending');

  const replay = await submitApproval(req('/api/workflow/approvals', 'POST', requester, payload));
  assert.equal(replay.status, 200);
  assert.equal((await json(replay)).replayed, true);

  const unauthorized = await decideApproval(req(`/api/workflow/approvals/${approvalId}/commands`, 'POST', stranger, { key: randomUUID(), version: 1, command: 'approve' }), params);
  assert.equal(unauthorized.status, 403);

  const decisionKey = randomUUID();
  const approved = await decideApproval(req(`/api/workflow/approvals/${approvalId}/commands`, 'POST', approver, { key: decisionKey, version: 1, command: 'approve' }), params);
  assert.equal(approved.status, 200, JSON.stringify(await json(approved.clone())));
  assert.deepEqual((await json(approved)).state, 'approved');
  const applied = await pool.query(
    'SELECT actor_id,period_start,period_end,status FROM finance_period_closes WHERE id=$1', [entityId],
  );
  assert.deepEqual(applied.rows, [{
    actor_id: requester, period_start: '2026-11-01', period_end: '2026-11-30', status: 'closed',
  }]);
  const closingAudit = await pool.query(
    "SELECT actor_id,metadata FROM finance_audit_events WHERE entity_type='finance_period' AND entity_id=$1",
    [entityId],
  );
  assert.equal(closingAudit.rows.length, 1);
  assert.equal(closingAudit.rows[0].actor_id, approver);
  assert.equal(closingAudit.rows[0].metadata.approvalRequestId, approvalId);

  const decisionReplay = await decideApproval(req(`/api/workflow/approvals/${approvalId}/commands`, 'POST', approver, { key: decisionKey, version: 1, command: 'approve' }), params);
  assert.equal(decisionReplay.status, 200);
  assert.equal((await json(decisionReplay)).replayed, true);

  const staleDecision = await decideApproval(req(`/api/workflow/approvals/${approvalId}/commands`, 'POST', approver, { key: randomUUID(), version: 1, command: 'approve' }), params);
  assert.equal(staleDecision.status, 409);

  const stored = await pool.query(`SELECT r.state,r.row_version,r.requested_by,r.approver_id,
      COUNT(e.id)::int AS events,
      COUNT(*) FILTER (WHERE e.event_type='approved')::int AS decisions
    FROM workflow_approval_requests r
    JOIN workflow_approval_events e ON e.request_id=r.id
    WHERE r.id=$1
    GROUP BY r.id`, [approvalId]);
  assert.deepEqual(stored.rows[0], { state: 'approved', row_version: 2, requested_by: requester, approver_id: approver, events: 2, decisions: 1 });
});
