import test from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../../app/api/health/route.ts';

test('liveness endpoint returns a no-store success without database access', async () => {
  const response = GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    service: 'cisne', status: 'ok', check: 'liveness',
  });
});
