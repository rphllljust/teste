import { randomUUID } from 'node:crypto';
import {
  approvedNextcrmPrivateBridge,approvedNextcrmMinioOrigin,
} from './approved-railway-targets.mjs';
import {
  NEXTCRM_BRIDGE_PATH, signBridgeRequest, verifyBridgeResponse,
} from './bridge-protocol.ts';
import {
  NextcrmBridgeUnavailable, type NextcrmBridgeConfig,
} from './nextcrm-http-document-verifier.ts';

/**
 * A one-minute S3 file ticket is exchanged ONLY with the private HMAC route.
 * The Field browser never receives that ticket or any MinIO credentials.
 * The existing metadata verifier is unchanged and remains fail-closed.
 */
export interface NextcrmFileTicketConfig extends NextcrmBridgeConfig {
  minioPublicOrigin: string;
  minioBucket: string;
}

export interface NextcrmFileTicketInput {
  documentId: string;
  subjectId: string;
  accountId: string;
  erpClientId: string;
  tenantKey: string;
  expectedVersion: number;
  expectedSha256: string;
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;

export async function requestNextcrmFileTicket(
  config: NextcrmFileTicketConfig, input: NextcrmFileTicketInput,
): Promise<string | null> {
  try {
    const privateUrl = new URL(config.baseUrl);
    const loopback = process.env.NODE_ENV === 'test' &&
      privateUrl.hostname === '127.0.0.1' && !!privateUrl.port;
    if (privateUrl.protocol !== 'http:' ||
        (!loopback && !approvedNextcrmPrivateBridge(config.baseUrl)) ||
        privateUrl.username || privateUrl.password ||
        (privateUrl.pathname !== '/' && privateUrl.pathname !== '') ||
        privateUrl.search || privateUrl.hash ||
        !/^[A-Za-z0-9_-]{3,128}$/.test(config.instanceKey) ||
        !Object.values(input).filter(v => typeof v === 'string').every(v => v.length <= 128) ||
        ![input.documentId, input.subjectId, input.accountId, input.erpClientId].every(v => UUID.test(v)) ||
        !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 ||
        !HASH.test(input.expectedSha256) ||
        input.tenantKey !== config.instanceKey ||
        !/^[A-Za-z0-9_-]{3,64}$/.test(config.minioBucket) ||
        !Number.isSafeInteger(config.timeoutMs ?? 3000) ||
        (config.timeoutMs ?? 3000) < 100 || (config.timeoutMs ?? 3000) > 5000) {
      throw new NextcrmBridgeUnavailable();
    }

    const allowed = new URL(config.minioPublicOrigin);
    if (allowed.protocol !== 'https:' || allowed.username || allowed.password ||
        allowed.pathname !== '/' || allowed.search || allowed.hash ||
        // Both approved origins are explicit names, never caller-controlled.
        !approvedNextcrmMinioOrigin(config.minioPublicOrigin))
      throw new NextcrmBridgeUnavailable();

    const body = JSON.stringify({
      documentId: input.documentId,
      subjectId: input.subjectId,
      accountId: input.accountId,
      erpClientId: input.erpClientId,
      tenantKey: input.tenantKey,
      requestId: randomUUID(),
      purpose: 'file',
    });
    const proof = signBridgeRequest(config.secret, body);
    const response = await (config.fetchImpl ?? fetch)(
      new URL(NEXTCRM_BRIDGE_PATH, privateUrl), {
        method: 'POST', redirect: 'error', cache: 'no-store',
        signal: AbortSignal.timeout(config.timeoutMs ?? 3000),
        headers: {
          'content-type': 'application/json',
          'x-cisne-bridge-timestamp': proof.timestamp,
          'x-cisne-bridge-nonce': proof.nonce,
          'x-cisne-bridge-signature': proof.signature,
        },
        body,
      },
    );
    if (response.status !== 200 && response.status !== 404)
      throw new NextcrmBridgeUnavailable();
    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > 4096 ||
        !verifyBridgeResponse(config.secret, raw, response.status, proof,
          response.headers.get('x-cisne-bridge-response-signature') ?? ''))
      throw new NextcrmBridgeUnavailable();
    if (response.status === 404) return null;

    const result: unknown = JSON.parse(raw);
    if (!result || typeof result !== 'object')
      throw new NextcrmBridgeUnavailable();
    const v = result as Record<string, unknown>;
    if (v.authorized !== true || v.id !== input.documentId ||
        v.accountId !== input.accountId || v.tenantKey !== input.tenantKey ||
        v.version !== input.expectedVersion ||
        v.sha256 !== input.expectedSha256 || v.expiresIn !== 60 ||
        typeof v.fileUrl !== 'string' || v.fileUrl.length > 2048)
      throw new NextcrmBridgeUnavailable();

    const signed = new URL(v.fileUrl);
    if (signed.protocol !== 'https:' || signed.origin !== allowed.origin ||
        signed.username || signed.password || signed.hash ||
        !signed.pathname.startsWith('/' + config.minioBucket + '/documents/') ||
        signed.searchParams.get('X-Amz-Algorithm') !== 'AWS4-HMAC-SHA256' ||
        signed.searchParams.get('X-Amz-Expires') !== '60' ||
        !/^[a-f0-9]{64}$/i.test(signed.searchParams.get('X-Amz-Signature') ?? '')) {
      throw new NextcrmBridgeUnavailable();
    }
    return v.fileUrl;
  } catch {
    // An invalid signature, URI, user/ACL, timeout, network failure or bad
    // metadata must NEVER become a downloadable link.
    throw new NextcrmBridgeUnavailable();
  }
}
