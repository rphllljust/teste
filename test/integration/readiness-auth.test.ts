import test from 'node:test';
import assert from 'node:assert/strict';
import { GET as getReadiness } from '../../app/api/health/ready/route';
import { GET as getOrders } from '../../app/api/orders/route';
import { GET as getFinance } from '../../app/api/finance/workspace/route';

if (process.env.NODE_ENV !== 'test') throw Error('Only the disposable PostgreSQL CI database is allowed');

test('readiness is real: the CI PostgreSQL ledger and required ERP tables exist', async () => {
  const result = await getReadiness();
  assert.equal(result.status, 200, await result.clone().text());
  assert.deepEqual(await result.json(), { status: 'ready' });
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
});

test('production Railway cannot impersonate an owner through user-controlled headers', async () => {
  const saved = {
    name: process.env.RAILWAY_ENVIRONMENT_NAME,
    service: process.env.RAILWAY_SERVICE_ID,
  };
  try {
    process.env.RAILWAY_ENVIRONMENT_NAME = 'production';
    process.env.RAILWAY_SERVICE_ID = 'synthetic-service';
    const request = (path: string) => new Request('https://example.up.railway.app' + path, {
      headers: {
        'oai-authenticated-user-id': 'forged-owner',
        'x-cisne-dispatch-secret': 'forged-secret',
      },
    });
    for (const response of [
      await getOrders(request('/api/orders')),
      await getFinance(request('/api/finance/workspace')),
    ]) {
      assert.equal(response.status, 401);
      const body = await response.json() as { code: string };
      assert.equal(body.code, 'AUTHENTICATION_REQUIRED');
    }
  } finally {
    for (const [name, value] of [
      ['RAILWAY_ENVIRONMENT_NAME', saved.name],
      ['RAILWAY_SERVICE_ID', saved.service],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
