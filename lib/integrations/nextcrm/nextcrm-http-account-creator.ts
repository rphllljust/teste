import { randomUUID } from 'node:crypto';
import {
  NEXTCRM_ACCOUNT_CREATE_PATH, NEXTCRM_BRIDGE_MAX_BODY_BYTES,
  signBridgeRequestForPath, verifyBridgeResponseForPath,
} from './bridge-protocol.ts';
import type { NextcrmBridgeConfig } from './nextcrm-http-document-verifier.ts';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const INSTANCE = /^[A-Za-z0-9_-]{3,128}$/;
const allowed = new Set([
  'officePhone', 'website', 'fax', 'email', 'companyId', 'vat',
  'billingStreet', 'billingPostalCode', 'billingCity', 'billingState', 'billingCountry',
  'shippingStreet', 'shippingPostalCode', 'shippingCity', 'shippingState', 'shippingCountry',
  'description', 'annualRevenue', 'memberOf',
]);

export class NextcrmAccountCreateUnavailable extends Error {
  constructor() { super('Não foi possível confirmar o cadastro empresarial no NextCRM.'); }
}
export class NextcrmAccountCreateConflict extends Error {
  constructor() { super('Já existe uma conta NextCRM vinculada a este identificador empresarial, sem permissão para reutilizá-la.'); }
}

/** The Field never accepts account IDs or ownership information from a browser. */
export async function createNextcrmAccountForClient(
  config: NextcrmBridgeConfig,
  subjectId: string, erpClientId: string, name: string,
  profile: Record<string, string | null>,
): Promise<{accountId: string; created: boolean}> {
  const url = new URL(config.baseUrl);
  const internal = url.protocol === 'http:' &&
    url.hostname === 'nextcrm-web.railway.internal' && url.port === '3000';
  const loopbackTest = process.env.NODE_ENV === 'test' &&
    url.protocol === 'http:' && url.hostname === '127.0.0.1' && Number(url.port) > 0;
  if ((!internal && !loopbackTest) || url.username || url.password ||
      (url.pathname && url.pathname !== '/') || url.search || url.hash ||
      !INSTANCE.test(config.instanceKey) ||
      !UUID.test(subjectId) || !UUID.test(erpClientId) ||
      name.trim().length < 2 || name.trim().length > 100 ||
      !Number.isSafeInteger(config.timeoutMs ?? 3000) ||
      (config.timeoutMs ?? 3000) < 100 || (config.timeoutMs ?? 3000) > 5000) {
    throw new NextcrmAccountCreateUnavailable();
  }
  const clean: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(profile)) {
    if (!allowed.has(key) || (value !== null && (typeof value !== 'string' || value.length > 500))) {
      throw new NextcrmAccountCreateUnavailable();
    }
    clean[key] = value;
  }
  const body = JSON.stringify({
    subjectId, erpClientId, tenantKey: config.instanceKey,
    requestId: randomUUID(), name: name.trim(), profile: clean,
  });
  if (Buffer.byteLength(body, 'utf8') > NEXTCRM_BRIDGE_MAX_BODY_BYTES) {
    throw new NextcrmAccountCreateUnavailable();
  }
  const fetcher = config.fetchImpl ?? fetch;
  let proof: ReturnType<typeof signBridgeRequestForPath>;
  try { proof = signBridgeRequestForPath(config.secret, body, NEXTCRM_ACCOUNT_CREATE_PATH); }
  catch { throw new NextcrmAccountCreateUnavailable(); }
  let response: Response;
  try {
    response = await fetcher(new URL(NEXTCRM_ACCOUNT_CREATE_PATH, url), {
      method: 'POST', redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(config.timeoutMs ?? 3000),
      headers: {
        'content-type': 'application/json',
        'x-cisne-bridge-timestamp': proof.timestamp,
        'x-cisne-bridge-nonce': proof.nonce,
        'x-cisne-bridge-signature': proof.signature,
      },
      body,
    });
    if (![200, 404, 409].includes(response.status)) throw new NextcrmAccountCreateUnavailable();
    const raw = await response.text();
    if (Buffer.byteLength(raw, 'utf8') > NEXTCRM_BRIDGE_MAX_BODY_BYTES ||
        !verifyBridgeResponseForPath(
          config.secret, raw, response.status, proof,
          response.headers.get('x-cisne-bridge-response-signature') ?? '',
          NEXTCRM_ACCOUNT_CREATE_PATH,
        )) throw new NextcrmAccountCreateUnavailable();
    if (response.status === 409) throw new NextcrmAccountCreateConflict();
    if (response.status === 404) throw new NextcrmAccountCreateUnavailable();
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') throw new NextcrmAccountCreateUnavailable();
    const x = value as Record<string, unknown>;
    if (x.authorized !== true || x.tenantKey !== config.instanceKey ||
        x.erpClientId !== erpClientId || typeof x.accountId !== 'string' ||
        !UUID.test(x.accountId) || typeof x.created !== 'boolean') {
      throw new NextcrmAccountCreateUnavailable();
    }
    return {accountId: x.accountId, created: x.created};
  } catch (error) {
    if (error instanceof NextcrmAccountCreateConflict ||
        error instanceof NextcrmAccountCreateUnavailable) throw error;
    throw new NextcrmAccountCreateUnavailable();
  }
}
