import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { closeDatabase } from '../../db/raw';
import { GET as listOrders } from '../../app/api/orders/route';
import { setTestIdentity } from '../../lib/api/test-identity.mjs';

if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL)
  throw Error('NO-GO: order list ownership requires an isolated test database');
const url = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(url.hostname) ||
    !['/cisne_test', '/cisne_ci'].includes(url.pathname) || url.port !== '5432')
  throw Error('NO-GO: refusing order fixtures outside disposable CI PostgreSQL');

test('OS worklist excludes another owner and legacy ownerless orders', async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const owner = randomUUID();
  const foreignOwner = randomUUID();
  const ownedId = randomUUID();
  const foreignId = randomUUID();
  const ownerlessId = randomUUID();
  const marker = `owner-scope-${randomUUID()}`;
  const now = new Date().toISOString();
  try {
    for (const [id, rowOwner] of [[ownedId, owner], [foreignId, foreignOwner], [ownerlessId, null]] as const) {
      await pool.query(
        `INSERT INTO service_orders(id,owner_id,title,client,category,description,created_at)
         VALUES($1,$2,$3,$4,'Serviços','Synthetic ownership fixture',$5)`,
        [id, rowOwner, marker, marker, now],
      );
    }

    const request = setTestIdentity(
      new Request(`http://localhost/api/orders?q=${encodeURIComponent(marker)}`),
      owner,
    );
    const response = await listOrders(request);
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json() as { items: Array<{ id: string }> };
    assert.deepEqual(body.items.map((item) => item.id), [ownedId]);
  } finally {
    await pool.query('DELETE FROM service_orders WHERE id=ANY($1::text[])', [[ownedId, foreignId, ownerlessId]]);
    await pool.end();
    await closeDatabase();
  }
});
