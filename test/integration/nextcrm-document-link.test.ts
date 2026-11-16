import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import {
  authorizeAndPersistOrderDocumentLink,
  OrderDocumentLinkConflict,
} from '../../lib/integrations/nextcrm/postgres-document-link.ts';
import {
  OrderDocumentLinkDenied,
  type OrderDocumentLinkDependencies,
} from '../../lib/integrations/nextcrm/document-link-preflight.ts';
import { createPostgresOrderOwnershipReader } from '../../lib/integrations/nextcrm/postgres-order-ownership.ts';

if (process.env.NODE_ENV !== 'test') throw new Error('Only ephemeral tests are allowed');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const url = new URL(process.env.DATABASE_URL);
if (!['localhost','127.0.0.1'].includes(url.hostname) || url.pathname !== '/cisne_test') {
  throw new Error('NO-GO: this test refuses non-ephemeral PostgreSQL targets');
}

test('NextCRM document link has exactly-once audit, idempotency and real PostgreSQL ownership enforcement', async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  const owner = randomUUID(), outsider = randomUUID();
  const clientId = randomUUID(), orderId = randomUUID(), orphanId = randomUUID();
  const now = new Date().toISOString();
  const deps: OrderDocumentLinkDependencies = {
    ...createPostgresOrderOwnershipReader(pool),
    resolveMappedIdentity: async (actorId: string) => ({
      erpActorId: actorId,
      nextcrmSubjectId: actorId === owner ? 'nextcrm-user-1' : 'nextcrm-user-foreign',
      tenantKey: 'tenant-synthetic',
    }),
    findAccountMapping: async (cid: string, tenant: string) =>
      cid === clientId && tenant === 'tenant-synthetic'
        ? { accountId: 'account-synthetic', tenantKey: tenant } : null,
    verifyDocumentForLink: async (doc: string, subject: string) =>
      subject === 'nextcrm-user-1' ? {
        id: doc, tenantKey: 'tenant-synthetic', accountId: 'account-synthetic',
        version: doc === 'doc_version2' ? 2 : 1,
        sha256: 'a'.repeat(64), canLink: true,
      } : null,
  };
  const payload = {
    serviceOrderId: orderId, nextcrmDocumentId: 'doc_original',
    documentKind: 'service_report' as const, version: 1,
    sha256: 'a'.repeat(64),
  };
  const idem = randomUUID();
  const perform = (actor=owner, data: unknown=payload, key=idem) =>
    authorizeAndPersistOrderDocumentLink({
      payload: data, trustedErpActorId: actor,
      idempotencyKey: key, correlationId: 'ci-nextcrm-test-0001',
      db: pool, dependencies: deps,
    });

  try {
    await pool.query('INSERT INTO clients(id,owner_id,legal_name,created_at,updated_at) VALUES($1,$2,$3,$4,$4)', [
      clientId, owner, 'Synthetic enterprise', now,
    ]);
    for (const [id, orderOwner] of [[orderId,owner],[orphanId,null]]) {
      await pool.query(`
        INSERT INTO service_orders(id,owner_id,client_id,title,client,category,description,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      `, [id, orderOwner, clientId, 'Synthetic OS', 'Synthetic enterprise', 'Serviços', 'CI only', now]);
    }

    const first = await perform();
    assert.equal(first.created, true);
    const same = await perform();
    assert.deepEqual(same, { id: first.id, created: false }, 'retry must not create duplicates');

    await assert.rejects(() => perform(owner, {...payload, documentKind: 'contract'}),
      (err: unknown) => err instanceof OrderDocumentLinkConflict);
    await assert.rejects(() => perform(owner, payload, randomUUID()),
      (err: unknown) => err instanceof OrderDocumentLinkConflict);
    await assert.rejects(() => perform(outsider),
      (err: unknown) => err instanceof OrderDocumentLinkDenied);
    await assert.rejects(() => perform(owner, {...payload,serviceOrderId: orphanId}),
      (err: unknown) => err instanceof OrderDocumentLinkDenied);

    const otherIdem = randomUUID();
    const versionTwo = { ...payload, nextcrmDocumentId: 'doc_version2', version: 2 };
    const parallel = await Promise.all([
      perform(owner, versionTwo, otherIdem),
      perform(owner, versionTwo, otherIdem),
    ]);
    assert.equal(parallel.filter(r => r.created).length, 1, 'one winner among concurrent retries');
    assert.equal(parallel[0].id, parallel[1].id, 'all retries must return same linked fact');

    const stored = await pool.query(
      'SELECT id, owner_id, erp_client_id, document_version, tenant_key, request_hash FROM nextcrm_order_document_links WHERE service_order_id=$1 ORDER BY document_version',
      [orderId],
    );
    assert.equal(stored.rowCount, 2);
    assert.equal(stored.rows[0].owner_id, owner);
    assert.equal(stored.rows[0].erp_client_id, clientId);
    assert.equal(stored.rows[0].tenant_key, 'tenant-synthetic');
    assert.equal(stored.rows[0].document_version, 1);
    assert.match(stored.rows[0].request_hash, /^[a-f0-9]{64}$/);

    const audit = await pool.query(
      'SELECT link_id,event_type,actor_id,request_hash FROM nextcrm_order_document_events WHERE link_id = ANY($1::text[])',
      [stored.rows.map(r => r.id)],
    );
    assert.equal(audit.rowCount, 2, 'one immutable audit event per created link');
    assert.ok(audit.rows.every(r => r.event_type === 'linked' && r.actor_id === owner));

    await assert.rejects(() =>
      pool.query('UPDATE nextcrm_order_document_links SET document_kind=$1 WHERE id=$2', ['photo',first.id]),
      (err: unknown) => err instanceof Error && err.message.includes('NEXTCRM_DOCUMENT_IMMUTABLE_FACT'));
    await assert.rejects(() =>
      pool.query('DELETE FROM nextcrm_order_document_events WHERE link_id=$1', [first.id]),
      (err: unknown) => err instanceof Error && err.message.includes('NEXTCRM_DOCUMENT_IMMUTABLE_FACT'));

    await pool.query('UPDATE clients SET status=$1 WHERE id=$2', ['inactive', clientId]);
    await assert.rejects(() => perform(owner, {...payload, nextcrmDocumentId: 'doc_third'}, randomUUID()),
      (err: unknown) => err instanceof OrderDocumentLinkDenied);

    const remaining = await pool.query(
      'SELECT COUNT(*)::int AS n FROM nextcrm_order_document_links WHERE service_order_id=$1', [orderId],
    );
    assert.equal(remaining.rows[0].n, 2, 'denied commands must leave no extra link');
  } finally {
    // The links are deliberately immutable; this fixture only touches the
    // throwaway PostgreSQL container created by GitHub Actions.
    await pool.end();
  }
});
