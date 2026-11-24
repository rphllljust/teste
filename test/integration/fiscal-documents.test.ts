import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { POST as registerDocument } from '../../app/api/fiscal/documents/route';
import { closeDatabase } from '../../db/raw';
import { setTestIdentity } from '../../lib/api/test-identity.mjs';

if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL) {
  throw new Error('Fiscal integration tests require NODE_ENV=test and DATABASE_URL');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
after(async () => { await closeDatabase(); await pool.end(); });

test('fiscal registration resolves persisted UUIDs and enforces source ownership and type', async () => {
  const owner = randomUUID(), other = randomUUID();
  const customerId = randomUUID(), orderId = randomUUID(), foreignOrderId = randomUUID();
  const now = new Date().toISOString();
  const issuedOn = now.slice(0, 10);
  const documentIds: string[] = [];
  async function register(links: Record<string, string>) {
    const id = randomUUID();
    documentIds.push(id);
    const request = setTestIdentity(new Request('http://localhost/api/fiscal/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id, direction: 'service', documentType: 'service_invoice',
        number: id, issuedOn, period: issuedOn.slice(0, 7), grossAmount: '100,25',
        ...links,
      }),
    }), owner);
    const response = await registerDocument(request);
    return { id, status: response.status, body: await response.json() as { error?: string; code?: string } };
  }

  try {
    await pool.query(
      'INSERT INTO clients(id,owner_id,legal_name,created_at,updated_at) VALUES($1,$2,$3,$4,$4)',
      [customerId, owner, 'Cliente fiscal CI', now],
    );
    await pool.query(
      `INSERT INTO service_orders(id,owner_id,client_id,title,client,category,description,created_at)
       VALUES($1,$2,$3,'OS fiscal CI','Cliente fiscal CI','Serviços','Fiscal CI',$4),
             ($5,$6,NULL,'Outra OS','Outro cliente','Serviços','Fiscal CI',$4)`,
      [orderId, owner, customerId, now, foreignOrderId, other],
    );

    const malformed = await register({ orderId: orderId.slice(0, 8) });
    assert.equal(malformed.status, 400);
    assert.match(malformed.body.error ?? '', /Ordem de serviço.*UUID completo/);

    const invalidLinks: Record<string, string>[] = [{ orderId: foreignOrderId }, { billingId: orderId }];
    for (const links of invalidLinks) {
      const rejected = await register(links);
      assert.equal(rejected.status, 422);
      assert.equal(rejected.body.code, 'FISCAL_ORIGIN_NOT_FOUND');
    }

    const created = await register({ orderId: ` ${orderId.toUpperCase()} `, customerId });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const saved = await pool.query(
      'SELECT id,order_id,customer_id,integration_provider FROM fiscal_documents WHERE id=ANY($1::text[])',
      [documentIds],
    );
    assert.deepEqual(saved.rows, [{ id: created.id, order_id: orderId, customer_id: customerId, integration_provider: 'manual' }]);
  } finally {
    await pool.query('DELETE FROM fiscal_document_events WHERE document_id=ANY($1::text[])', [documentIds]);
    await pool.query('DELETE FROM fiscal_documents WHERE id=ANY($1::text[])', [documentIds]);
    await pool.query('DELETE FROM business_commands WHERE id=ANY($1::text[])', [documentIds]);
    await pool.query('DELETE FROM service_orders WHERE id=ANY($1::text[])', [[orderId, foreignOrderId]]);
    await pool.query('DELETE FROM clients WHERE id=$1', [customerId]);
  }
});
