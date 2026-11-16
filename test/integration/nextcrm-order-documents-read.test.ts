import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { listVisibleNextcrmOrderDocuments } from '../../lib/integrations/nextcrm/order-documents-read.ts';

if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL) {
  throw new Error('Only isolated integration tests may read NextCRM metadata');
}
const target = new URL(process.env.DATABASE_URL);
if (!['127.0.0.1', 'localhost'].includes(target.hostname) ||
    !['/cisne_ci', '/cisne_test'].includes(target.pathname)) {
  throw new Error('NO-GO: refusal to use non-ephemeral PostgreSQL');
}

test('NextCRM document metadata appears inside owned OS and disappears on mapping revocation', async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  const owner = randomUUID();
  const outsider = randomUUID();
  const clientId = randomUUID();
  const orderId = randomUUID();
  const documentId = randomUUID();
  const instanceKey = 'cisne-ui-synthetic';
  const digest = 'a'.repeat(64);
  const now = new Date().toISOString();
  try {
    await pool.query(`
      INSERT INTO clients(id,owner_id,legal_name,created_at,updated_at)
      VALUES($1,$2,$3,$4,$4)`,
    [clientId, owner, 'Fictitious CRM client', now]);
    await pool.query(`
      INSERT INTO service_orders(id,owner_id,client_id,title,client,category,description,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [orderId,owner,clientId,'Synthetic NextCRM OS','Fictitious CRM client','Serviços','Test only',now]);
    await pool.query(`
      INSERT INTO nextcrm_erp_identity_mappings
        (erp_actor_id,nextcrm_subject_id,instance_key,active,verified_source,verified_by,verified_at)
      VALUES($1,$2,$3,true,$4,$5,now())`,
    [owner,randomUUID(),instanceKey,'test-identity-verified','ci-reviewer']);
    await pool.query(`
      INSERT INTO nextcrm_erp_client_account_mappings
        (erp_client_id,erp_owner_id,nextcrm_account_id,instance_key,active,verified_source,verified_by,verified_at)
      VALUES($1,$2,$3,$4,true,$5,$6,now())`,
    [clientId,owner,documentId,instanceKey,'test-account-verified','ci-reviewer']);
    await pool.query(`
      INSERT INTO nextcrm_order_document_links(
        id,service_order_id,owner_id,erp_client_id,tenant_key,nextcrm_account_id,
        nextcrm_document_id,document_kind,document_version,sha256,
        idempotency_key,request_hash,created_by,correlation_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,'service_report',1,$8,$9,$10,$3,$11)`,
    [randomUUID(),orderId,owner,clientId,instanceKey,documentId,
      randomUUID(),digest,randomUUID(),'b'.repeat(64),'ci-synthetic-panel']);

    const visible = await listVisibleNextcrmOrderDocuments(pool, orderId, owner);
    assert.equal(visible.orderFound, true);
    assert.equal(visible.items.length, 1);
    assert.equal(visible.items[0].kind, 'service_report');
    assert.equal(visible.items[0].sha256, digest);
    assert.deepEqual(Object.keys(visible.items[0]).sort(), ['id','kind','version','sha256','linkedAt'].sort());
    assert.equal('downloadUrl' in visible.items[0], false);
    assert.deepEqual(await listVisibleNextcrmOrderDocuments(pool, orderId, outsider),
      { orderFound: false, items: [], hasMore: false });

    await pool.query('UPDATE nextcrm_erp_client_account_mappings SET active=false WHERE erp_client_id=$1',[clientId]);
    assert.deepEqual((await listVisibleNextcrmOrderDocuments(pool,orderId,owner)).items,[],
      'revoked account must hide immutable history');
    await pool.query('UPDATE nextcrm_erp_client_account_mappings SET active=true WHERE erp_client_id=$1',[clientId]);
    await pool.query('UPDATE nextcrm_erp_identity_mappings SET active=false WHERE erp_actor_id=$1',[owner]);
    assert.deepEqual((await listVisibleNextcrmOrderDocuments(pool,orderId,owner)).items,[],
      'revoked subject must hide immutable history');
    await pool.query('UPDATE nextcrm_erp_identity_mappings SET active=true WHERE erp_actor_id=$1',[owner]);
    await pool.query('UPDATE clients SET status=$1 WHERE id=$2',['inactive',clientId]);
    assert.deepEqual((await listVisibleNextcrmOrderDocuments(pool,orderId,owner)).items,[],
      'inactive ERP client must not expose NextCRM document metadata');
  } finally {
    // Test fixtures and immutable links remain only in disposable CI PostgreSQL.
    await pool.end();
  }
});
