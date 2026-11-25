import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('measurement lifecycle declares only supported enterprise states', async () => {
  const [migration, route, schema] = await Promise.all([
    readFile('drizzle-pg/0013_field_service_measurement_lifecycle.sql', 'utf8'),
    readFile('app/api/orders/[id]/measurements/[measurementId]/commands/route.ts', 'utf8'),
    readFile('db/schema.ts', 'utf8'),
  ]);
  for (const state of ['draft','submitted','approved','billed','cancelled']) {
    assert.match(migration, new RegExp(state));
    assert.match(schema, new RegExp(state));
  }
  assert.match(route, /command:z\.enum\(\['submit','cancel'\]\)/);
  assert.match(route, /!\['draft','submitted'\]\.includes\(measurement\.status\)/);
  assert.match(route, /cancellation_reason/);
  assert.doesNotMatch(migration, /rejected/);
  assert.doesNotMatch(schema, /rejected/);
});
