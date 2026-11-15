import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { createPostgresOrderOwnershipReader } from '../../lib/integrations/nextcrm/postgres-order-ownership.ts';
import { authorizeOrderDocumentLink, OrderDocumentLinkDenied } from '../../lib/integrations/nextcrm/document-link-preflight.ts';

if (process.env.NODE_ENV !== 'test') throw new Error('This integration test is restricted to NODE_ENV=test');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const target = new URL(process.env.DATABASE_URL);
if (target.hostname !== '127.0.0.1' || target.pathname !== '/cisne_ci') {
  throw new Error('NO-GO: refuse to run integration fixtures against a non-ephemeral PostgreSQL database');
}

test('real PostgreSQL ownership lookup and document preflight fail closed for other users and orphaned OS', async () => {
  const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const actor = randomUUID(), foreign = randomUUID(), clientId = randomUUID();
  const orderId = randomUUID(), orphanId = randomUUID();
  const now = new Date().toISOString();
  const reader = createPostgresOrderOwnershipReader(db);
  try {
    await db.query(
      'INSERT INTO clients(id, owner_id, legal_name, created_at, updated_at) VALUES ($1,$2,$3,$4,$4)',
      [clientId, actor, 'CI synthetic client', now],
    );
    for (const [id, owner] of [[orderId, actor], [orphanId, null]]) {
      await db.query(
        'INSERT INTO service_orders(id,owner_id,client_id,title,client,category,description,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [id, owner, clientId, 'Synthetic OS', 'CI synthetic client', 'Serviços', 'No real customer data', now],
      );
    }
    assert.deepEqual(await reader.findOwnedOrder(orderId, actor), {
      id: orderId, ownerId: actor, clientId,
    });
    assert.equal(await reader.findOwnedOrder(orderId, foreign), null, 'foreign actor must not read the order');
    assert.equal(await reader.findOwnedOrder(orphanId, actor), null, 'ownerless order must not be linkable');
    assert.equal(await reader.findOwnedOrder('../escape', actor), null, 'invalid IDs are rejected before SQL');

    const request = { serviceOrderId: orderId, nextcrmDocumentId: 'document_c123', documentKind: 'service_report', version: 1 };
    const deps = {
      ...reader,
      resolveMappedIdentity: async (id) => ({
        erpActorId: id, nextcrmSubjectId: id === actor ? 'crm-subject-A' : 'crm-subject-B', tenantKey: 'tenant-A',
      }),
      findAccountMapping: async (cid, tenant) => cid === clientId && tenant === 'tenant-A'
        ? { accountId: 'account-A', tenantKey: tenant } : null,
      verifyDocumentForLink: async (doc, sub) => sub === 'crm-subject-A'
        ? { id: doc, tenantKey: 'tenant-A', accountId: 'account-A', version: 1, sha256: null, canLink: true } : null,
    };
    const permitted = await authorizeOrderDocumentLink(request, actor, deps);
    assert.equal(permitted.ownerId, actor);
    assert.equal(permitted.erpClientId, clientId);
    await assert.rejects(
      () => authorizeOrderDocumentLink(request, foreign, deps),
      (e) => e instanceof OrderDocumentLinkDenied,
    );
    await assert.rejects(
      () => authorizeOrderDocumentLink({...request, serviceOrderId: orphanId}, actor, deps),
      (e) => e instanceof OrderDocumentLinkDenied,
    );
    await db.query('UPDATE clients SET status=$1 WHERE id=$2', ['inactive', clientId]);
    assert.equal(await reader.findOwnedOrder(orderId, actor), null, 'inactive client cannot be linked');
  } finally {
    await db.query('DELETE FROM service_orders WHERE id = ANY($1::text[])', [[orderId, orphanId]]);
    await db.query('DELETE FROM clients WHERE id=$1', [clientId]);
    await db.end();
  }
});
