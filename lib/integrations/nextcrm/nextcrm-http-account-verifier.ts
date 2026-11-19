import { randomUUID } from 'node:crypto';
import {
  NEXTCRM_ACCOUNT_LOOKUP_PATH,
  signBridgeRequestForPath,
  verifyBridgeResponseForPath,
} from './bridge-protocol.ts';
import type { NextcrmBridgeConfig } from './nextcrm-http-document-verifier.ts';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const INSTANCE = /^[A-Za-z0-9_-]{3,128}$/;

export class NextcrmAccountLookupUnavailable extends Error {
  readonly code = 'NEXTCRM_ACCOUNT_LOOKUP_UNAVAILABLE';
  constructor() { super('A conta NextCRM não pôde ser confirmada para este cliente.'); }
}

export type NextcrmAccountEvidence = {
  accountId: string;
  erpClientId: string;
  tenantKey: string;
};

export function createNextcrmHttpAccountVerifier(config: NextcrmBridgeConfig) {
  const url = new URL(config.baseUrl);
  const internal = url.protocol === 'http:' &&
    url.hostname === 'nextcrm-web.railway.internal' && url.port === '3000';
  const loopbackTest = process.env.NODE_ENV === 'test' &&
    url.protocol === 'http:' && url.hostname === '127.0.0.1' && Number(url.port) > 0;
  if ((!internal && !loopbackTest) || url.username || url.password ||
      (url.pathname && url.pathname !== '/') || url.search || url.hash ||
      !INSTANCE.test(config.instanceKey) ||
      !Number.isSafeInteger(config.timeoutMs ?? 3000) ||
      (config.timeoutMs ?? 3000) < 100 || (config.timeoutMs ?? 3000) > 5000) {
    throw new NextcrmAccountLookupUnavailable();
  }

  const fetcher = config.fetchImpl ?? fetch;
  const endpoint = new URL(NEXTCRM_ACCOUNT_LOOKUP_PATH, url);

  return {
    async lookupAccountForClient(
      subjectId: string, erpClientId: string, tenantKey: string,
    ): Promise<NextcrmAccountEvidence | null> {
      if (![subjectId, erpClientId].every(x => UUID.test(x)) ||
          !INSTANCE.test(tenantKey) || tenantKey !== config.instanceKey) return null;

      const body = JSON.stringify({
        subjectId, erpClientId, tenantKey, requestId: randomUUID(),
      });
      const proof = signBridgeRequestForPath(config.secret, body, NEXTCRM_ACCOUNT_LOOKUP_PATH);
      let response: Response;
      try {
        response = await fetcher(endpoint, {
          method: 'POST',
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.timeout(config.timeoutMs ?? 3000),
          headers: {
            'content-type': 'application/json',
            'x-cisne-bridge-timestamp': proof.timestamp,
            'x-cisne-bridge-nonce': proof.nonce,
            'x-cisne-bridge-signature': proof.signature,
          },
          body,
        });
        if (response.status !== 200 && response.status !== 404) {
          throw new NextcrmAccountLookupUnavailable();
        }
        const raw = await response.text();
        if (Buffer.byteLength(raw, 'utf8') > 2048 ||
            !verifyBridgeResponseForPath(
              config.secret, raw, response.status, proof,
              response.headers.get('x-cisne-bridge-response-signature') ?? '',
              NEXTCRM_ACCOUNT_LOOKUP_PATH,
            )) throw new NextcrmAccountLookupUnavailable();
        if (response.status === 404) return null;

        const value: unknown = JSON.parse(raw);
        if (!value || typeof value !== 'object') throw new NextcrmAccountLookupUnavailable();
        const x = value as Record<string, unknown>;
        if (x.authorized !== true || x.tenantKey !== tenantKey ||
            x.erpClientId !== erpClientId || typeof x.accountId !== 'string' ||
            !UUID.test(x.accountId)) throw new NextcrmAccountLookupUnavailable();
        return {accountId: x.accountId, erpClientId, tenantKey};
      } catch (error) {
        if (error instanceof NextcrmAccountLookupUnavailable) throw error;
        throw new NextcrmAccountLookupUnavailable();
      }
    },
  };
}
