// Public Railway RC78 smoke: no secrets, no auth, no valid business mutations.
import assert from 'node:assert/strict';
const ORIGIN = 'https://cisne-rc78-readonly-candidate-staging.up.railway.app';
const tests = [
  { path: '/api/orders', method: 'GET', code: 'STAGING_PRIVATE_ACCESS_REQUIRED' },
  { path: '/api/finance/workspace', method: 'GET', code: 'STAGING_PRIVATE_ACCESS_REQUIRED' },
  { path: '/api/operation?kind=receivables', method: 'GET', code: 'STAGING_PRIVATE_ACCESS_REQUIRED' },
  { path: '/api/orders', method: 'GET', headers: { 'oai-authenticated-user-id': 'forged-identity' }, code: 'STAGING_PRIVATE_ACCESS_REQUIRED' },
  { path: '/api/orders', method: 'POST', body: '{}', code: 'STAGING_READ_ONLY_PREVIEW' },
  { path: '/api/commands', method: 'POST', body: '{}', code: 'STAGING_READ_ONLY_PREVIEW' },
  { path: '/api/finance/receivables/settlements', method: 'POST', body: '{}', code: 'STAGING_READ_ONLY_PREVIEW' },
];
async function probe(path, options = {}) {
  const url = new URL(path, ORIGIN);
  assert.equal(url.origin, ORIGIN);
  const response = await fetch(url, {
    redirect: 'manual', signal: AbortSignal.timeout(8000), ...options,
  });
  const raw = await response.text();
  if (raw.length > 1000) throw new Error('Unexpectedly large public API response');
  let body;
  try { body = JSON.parse(raw); } catch {
    throw new Error('Public API did not return a short JSON payload');
  }
  return { status: response.status, headers: response.headers, body };
}
async function run() {
  // Railway deploys asynchronously. Operator independently confirms the
  // exact PR head SHA in Railway deployment metadata after this gate passes.
  let ready = false;
  for (let i = 0; i < 48; i++) {
    try {
      const response = await probe('/api/health/ready');
      if (response.status === 200 && response.body.status === 'ready' &&
          response.headers.get('cache-control')?.includes('no-store')) {
        ready = true;
        break;
      }
      console.info('Readiness pending: attempt ' + (i + 1));
    } catch (e) {
      console.info('Readiness pending: attempt ' + (i + 1) + ', reason=' +
        (e?.name === 'TimeoutError' ? 'timeout' : 'unreachable'));
    }
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  assert.equal(ready, true, 'Railway RC78 readiness never achieved HTTP 200');
  console.log('READY: 200, no-store, minimal status ready');

  for (const testcase of tests) {
    const options = { method: testcase.method, headers: {
      ...(testcase.method === 'POST' ? {
        'content-type': 'application/json', origin: ORIGIN,
      } : {}),
      ...(testcase.headers || {}),
    } };
    if (testcase.body !== undefined) options.body = testcase.body;
    const result = await probe(testcase.path, options);
    const label = testcase.method + ' ' + testcase.path;
    assert.equal(result.status, 403, 'Unexpected access granted for ' + label);
    assert.equal(result.body.code, testcase.code, 'Unexpected deny contract for ' + label);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    console.log('DENY 403: ' + label);
  }
  console.log('PASS: 1 readiness + 7 anonymous/forged access probes');
}
await run();
