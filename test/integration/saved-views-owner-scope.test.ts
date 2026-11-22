import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { setTestIdentity } from '../../lib/api/test-identity.mjs';
import { closeDatabase } from '../../db/raw';
import { GET as listViews, POST as saveView } from '../../app/api/views/route';

if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL)
  throw Error('NO-GO: view ownership test needs isolated PostgreSQL');
const target = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(target.hostname) ||
    target.port !== '5432' || !['/cisne_ci', '/cisne_test'].includes(target.pathname))
  throw Error('NO-GO: refusing saved view test on non-disposable database');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const alice = randomUUID(), bob = randomUUID(), shared = randomUUID(), contested = randomUUID();
const definition = {
  schemaVersion: 1,
  entityKey: 'serviceOrder',
  viewKey: 'serviceOrders.worklist',
  filters: { query: '', category: 'Todas as atividades', view: 'Todas as ordens' },
  sort: 'createdAt.desc',
  visibleColumns: ['order', 'status'],
  pageSize: 25,
};
const req = (method: 'GET' | 'POST', actor: string, payload?: unknown) =>
  setTestIdentity(new Request('http://localhost/api/views', {
    method,
    headers: { 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  }), actor);
const payload = (id: string, name: string) => ({ id, name, definition });

test('shared default is readable, never writable; competing owners cannot take over a saved view', async () => {
  try {
    await pool.query(
      "INSERT INTO saved_views(id,name,query,category,view,created_at,owner_id,definition,schema_version,row_version,is_default,view_key) VALUES($1,$2,'','','',$3,NULL,$4,1,1,1,$5)",
      [shared, 'Modelo compartilhado de CI', new Date().toISOString(),
        JSON.stringify(definition), definition.viewKey]);
    for (const actor of [alice, bob]) {
      const result = await listViews(req('GET', actor));
      assert.equal(result.status, 200);
      const json = await result.json() as { views: Array<{id:string;compatible:boolean;isDefault:boolean}> };
      assert.ok(json.views.some(v => v.id === shared && v.compatible && v.isDefault),
        'Official shared templates remain visible');
      const rejected = await saveView(req('POST', actor, payload(shared, 'Overwritten template')));
      assert.equal(rejected.status, 409, 'A global template cannot be overwritten');
    }

    const responses = await Promise.all([
      saveView(req('POST', alice, payload(contested, 'Alice private view'))),
      saveView(req('POST', bob, payload(contested, 'Bob private view'))),
    ]);
    assert.deepEqual(responses.map(r => r.status).sort(), [201,409],
      'Concurrent upserts with the same UUID must have precisely one winner');
    const saved = await pool.query(
      'SELECT owner_id,name,row_version FROM saved_views WHERE id=$1', [contested]);
    assert.equal(saved.rowCount, 1);
    const winner = saved.rows[0].owner_id as string;
    assert.ok(winner === alice || winner === bob);
    const loser = winner === alice ? bob : alice;
    assert.equal((await saveView(req('POST', loser, payload(contested, 'Takeover')))).status, 409);
    const updated = await saveView(req('POST', winner, payload(contested, 'Updated private view')));
    assert.equal(updated.status, 200);
    const final = await pool.query('SELECT owner_id,name,row_version FROM saved_views WHERE id=$1', [contested]);
    assert.deepEqual(final.rows[0], { owner_id: winner, name: 'Updated private view', row_version: 2 });
    const global = await pool.query('SELECT owner_id,name FROM saved_views WHERE id=$1', [shared]);
    assert.deepEqual(global.rows[0], { owner_id: null, name: 'Modelo compartilhado de CI' });
  } finally {
    await pool.query('DELETE FROM saved_views WHERE id=ANY($1::text[])', [[shared, contested]]);
    await closeDatabase();
    await pool.end();
  }
});
