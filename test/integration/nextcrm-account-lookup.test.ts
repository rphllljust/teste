import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  createNextcrmHttpAccountVerifier,
} from '../../lib/integrations/nextcrm/nextcrm-http-account-verifier.ts';
import {
  NEXTCRM_ACCOUNT_LOOKUP_PATH,
  signBridgeResponseForPath,
} from '../../lib/integrations/nextcrm/bridge-protocol.ts';

test('account lookup accepts only a signed verified CRM response', async () => {
  const secret = randomBytes(32).toString('hex');
  const accountId = randomUUID();
  const erpClientId = randomUUID();
  const subjectId = randomUUID();
  const tenantKey = 'cisne-ci-account';
  const verifier = createNextcrmHttpAccountVerifier({
    baseUrl: 'http://127.0.0.1:5555',
    secret,
    instanceKey: tenantKey,
    timeoutMs: 1000,
    fetchImpl: async (_input, init) => {
      const headers = new Headers(init?.headers);
      const proof = {
        timestamp: headers.get('x-cisne-bridge-timestamp') ?? '',
        nonce: headers.get('x-cisne-bridge-nonce') ?? '',
      };
      const body = JSON.stringify({
        authorized: true, accountId, erpClientId, tenantKey,
      });
      return new Response(body, {
        status: 200,
        headers: {
          'x-cisne-bridge-response-signature': signBridgeResponseForPath(
            secret, body, 200, proof, NEXTCRM_ACCOUNT_LOOKUP_PATH,
          ),
        },
      });
    },
  });

  const result = await verifier.lookupAccountForClient(subjectId, erpClientId, tenantKey);
  assert.deepEqual(result, { accountId, erpClientId, tenantKey });
});
