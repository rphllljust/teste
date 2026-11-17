import { randomUUID } from 'node:crypto';
import { approvedNextcrmPrivateBridge } from './approved-railway-targets.mjs';
import {
  NEXTCRM_BRIDGE_PATH,
  signBridgeRequest,
  verifyBridgeResponse,
} from './bridge-protocol.ts';
import type {
  AuthorizedDocumentEvidence,
  OrderDocumentLinkDependencies,
} from './document-link-preflight.ts';

export class NextcrmBridgeUnavailable extends Error {
  readonly code = 'NEXTCRM_BRIDGE_UNAVAILABLE';
  constructor() { super('A autorização do documento NextCRM não pôde ser comprovada.'); }
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const INSTANCE = /^[a-zA-Z0-9_-]{3,128}$/;
const HEX64 = /^[a-f0-9]{64}$/;

export interface NextcrmBridgeConfig {
  baseUrl: string;
  secret: string;
  instanceKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function createNextcrmHttpDocumentVerifier(
  config: NextcrmBridgeConfig,
): Pick<OrderDocumentLinkDependencies, 'verifyDocumentForLink'> {
  const url = new URL(config.baseUrl);
  // The production bridge is reachable ONLY over Railway's internal DNS.
  // Never send the shared secret, IDs or CRM request to a user-provided URL.
  const internal = approvedNextcrmPrivateBridge(config.baseUrl);
  const loopbackTest = process.env.NODE_ENV === 'test' &&
    url.protocol === 'http:' && url.hostname === '127.0.0.1' && Number(url.port) > 0;
  if ((!internal && !loopbackTest) || url.username || url.password ||
      (url.pathname && url.pathname !== '/') || url.search || url.hash ||
      !INSTANCE.test(config.instanceKey) ||
      !Number.isSafeInteger(config.timeoutMs ?? 3000) ||
      (config.timeoutMs ?? 3000) < 100 || (config.timeoutMs ?? 3000) > 5000) {
    throw new NextcrmBridgeUnavailable();
  }
  // Fail before network access if the key has not been securely configured.
  try { signBridgeRequest(config.secret, '{}'); }
  catch { throw new NextcrmBridgeUnavailable(); }
  const fetcher = config.fetchImpl ?? fetch;
  const endpoint = new URL(NEXTCRM_BRIDGE_PATH, url);
  return {
    async verifyDocumentForLink(
      documentId: string, subjectId: string, accountId: string,
      erpClientId: string, tenantKey: string,
    ): Promise<AuthorizedDocumentEvidence | null> {
      if (![documentId, subjectId, accountId, erpClientId].every(x => UUID.test(x)) ||
          !INSTANCE.test(tenantKey) || tenantKey !== config.instanceKey) {
        return null;
      }
      const body = JSON.stringify({
        documentId, subjectId, accountId, erpClientId, tenantKey, requestId: randomUUID(),
      });
      const proof = signBridgeRequest(config.secret, body);
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
        if (response.status !== 200 && response.status !== 404) throw new NextcrmBridgeUnavailable();
        const raw = await response.text();
        if (Buffer.byteLength(raw, 'utf8') > 2048 ||
            !verifyBridgeResponse(config.secret, raw, response.status, proof,
              response.headers.get('x-cisne-bridge-response-signature') ?? '')) {
          throw new NextcrmBridgeUnavailable();
        }
        if (response.status === 404) return null;
        const value: unknown = JSON.parse(raw);
        if (!value || typeof value !== 'object') throw new NextcrmBridgeUnavailable();
        const x = value as Record<string, unknown>;
        if (x.authorized !== true || x.id !== documentId ||
            x.accountId !== accountId || x.tenantKey !== tenantKey ||
            typeof x.version !== 'number' || !Number.isInteger(x.version) || x.version < 1 ||
            (x.sha256 !== null && !(typeof x.sha256 === 'string' && HEX64.test(x.sha256)))) {
          throw new NextcrmBridgeUnavailable();
        }
        return {
          id: documentId, accountId, tenantKey, version: x.version,
          sha256: x.sha256 as string | null, canLink: true,
        };
      } catch {
        // Never silently interpret an auth transport failure as permission.
        throw new NextcrmBridgeUnavailable();
      }
    },
  };
}
