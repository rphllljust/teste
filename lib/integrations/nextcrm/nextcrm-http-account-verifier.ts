import { randomUUID } from 'node:crypto';
import {
  NEXTCRM_ACCOUNT_LOOKUP_PATH,
  NEXTCRM_ACCOUNT_UPDATE_PATH,
  NEXTCRM_ACCOUNT_CREATE_PATH,
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

export type NextcrmAccountProfile = {
  name: string | null;
  officePhone: string | null;
  website: string | null;
  fax: string | null;
  companyId: string | null;
  vat: string | null;
  email: string | null;
  billingStreet: string | null;
  billingPostalCode: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingCountry: string | null;
  shippingStreet: string | null;
  shippingPostalCode: string | null;
  shippingCity: string | null;
  shippingState: string | null;
  shippingCountry: string | null;
  description: string | null;
  annualRevenue: string | null;
  memberOf: string | null;
  industry: string | null;
  pricelistId: string | null;
  status: string | null;
  type: string | null;
};

export type NextcrmAccountEvidence = {
  accountId: string;
  erpClientId: string;
  tenantKey: string;
  profile?: NextcrmAccountProfile | null;
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
      let proof: ReturnType<typeof signBridgeRequestForPath>;
      try {
        proof = signBridgeRequestForPath(config.secret, body, NEXTCRM_ACCOUNT_LOOKUP_PATH);
      } catch {
        throw new NextcrmAccountLookupUnavailable();
      }
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
        const profileValue = x.profile;
        let profile: NextcrmAccountProfile | null = null;
        if (profileValue && typeof profileValue === 'object') {
          const p = profileValue as Record<string, unknown>;
          const text = (key: string) => typeof p[key] === 'string' ? p[key] as string : null;
          profile = {
            name: text('name'),
            officePhone: text('officePhone'),
            website: text('website'),
            fax: text('fax'),
            companyId: text('companyId'),
            vat: text('vat'),
            email: text('email'),
            billingStreet: text('billingStreet'),
            billingPostalCode: text('billingPostalCode'),
            billingCity: text('billingCity'),
            billingState: text('billingState'),
            billingCountry: text('billingCountry'),
            shippingStreet: text('shippingStreet'),
            shippingPostalCode: text('shippingPostalCode'),
            shippingCity: text('shippingCity'),
            shippingState: text('shippingState'),
            shippingCountry: text('shippingCountry'),
            description: text('description'),
            annualRevenue: text('annualRevenue'),
            memberOf: text('memberOf'),
            industry: text('industry'),
            pricelistId: text('pricelistId'),
            status: text('status'),
            type: text('type'),
          };
        }
        return profile ? {accountId: x.accountId, erpClientId, tenantKey, profile} : {accountId: x.accountId, erpClientId, tenantKey};
      } catch (error) {
        if (error instanceof NextcrmAccountLookupUnavailable) throw error;
        throw new NextcrmAccountLookupUnavailable();
      }
    },
    async updateAccountForClient(
      subjectId: string,
      erpClientId: string,
      tenantKey: string,
      accountId: string,
      changes: Record<string, string | null>,
    ): Promise<{ accountId: string }> {
      if (![subjectId, erpClientId, accountId].every(x => UUID.test(x)) ||
          !INSTANCE.test(tenantKey) || tenantKey !== config.instanceKey) {
        throw new NextcrmAccountLookupUnavailable();
      }
      const allowed = new Set([
        'officePhone', 'website', 'fax', 'email', 'billingStreet',
        'billingPostalCode', 'billingCity', 'billingState', 'billingCountry',
        'shippingStreet', 'shippingPostalCode', 'shippingCity',
        'shippingState', 'shippingCountry', 'description', 'annualRevenue',
        'memberOf', 'vat', 'companyId', 'industry', 'pricelistId', 'status', 'type',
      ]);
      const safeChanges: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(changes)) {
        if (!allowed.has(key) || (value !== null && typeof value !== 'string') ||
            (typeof value === 'string' && value.length > 500)) {
          throw new NextcrmAccountLookupUnavailable();
        }
        safeChanges[key] = value;
      }
      if (!Object.keys(safeChanges).length) throw new NextcrmAccountLookupUnavailable();

      const body = JSON.stringify({
        subjectId, erpClientId, tenantKey, accountId,
        changes: safeChanges, requestId: randomUUID(),
      });
      let proof: ReturnType<typeof signBridgeRequestForPath>;
      try {
        proof = signBridgeRequestForPath(config.secret, body, NEXTCRM_ACCOUNT_UPDATE_PATH);
      } catch {
        throw new NextcrmAccountLookupUnavailable();
      }
      try {
        const response = await fetcher(new URL(NEXTCRM_ACCOUNT_UPDATE_PATH, url), {
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
        const raw = await response.text();
        if ((response.status !== 200 && response.status !== 404) ||
            Buffer.byteLength(raw, 'utf8') > 2048 ||
            !verifyBridgeResponseForPath(
              config.secret, raw, response.status, proof,
              response.headers.get('x-cisne-bridge-response-signature') ?? '',
              NEXTCRM_ACCOUNT_UPDATE_PATH,
            )) throw new NextcrmAccountLookupUnavailable();
        if (response.status === 404) throw new NextcrmAccountLookupUnavailable();
        const value: unknown = JSON.parse(raw);
        if (!value || typeof value !== 'object') throw new NextcrmAccountLookupUnavailable();
        const x = value as Record<string, unknown>;
        if (x.authorized !== true || x.tenantKey !== tenantKey ||
            x.erpClientId !== erpClientId || x.accountId !== accountId) {
          throw new NextcrmAccountLookupUnavailable();
        }
        return { accountId };
      } catch (error) {
        if (error instanceof NextcrmAccountLookupUnavailable) throw error;
        throw new NextcrmAccountLookupUnavailable();
      }
    },
    async createAccountForClient(
      subjectId: string,
      erpClientId: string,
      tenantKey: string,
      name: string,
      changes: Record<string, string | null>,
    ): Promise<{ accountId: string; created: boolean }> {
      if (![subjectId, erpClientId].every(x => UUID.test(x)) ||
          !INSTANCE.test(tenantKey) || tenantKey !== config.instanceKey ||
          typeof name !== 'string' || name.trim().length < 2 || name.length > 200) {
        throw new NextcrmAccountLookupUnavailable();
      }
      const allowed = new Set([
        'officePhone', 'website', 'fax', 'email', 'billingStreet',
        'billingPostalCode', 'billingCity', 'billingState', 'billingCountry',
        'shippingStreet', 'shippingPostalCode', 'shippingCity',
        'shippingState', 'shippingCountry', 'description', 'annualRevenue',
        'memberOf', 'vat', 'companyId', 'industry', 'pricelistId', 'status', 'type',
      ]);
      const safeChanges: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(changes)) {
        if (!allowed.has(key) || (value !== null && typeof value !== 'string') ||
            (typeof value === 'string' && value.length > 500)) {
          throw new NextcrmAccountLookupUnavailable();
        }
        safeChanges[key] = value;
      }
      const body = JSON.stringify({
        subjectId, erpClientId, tenantKey, name: name.trim(), changes: safeChanges, requestId: randomUUID(),
      });
      let proof: ReturnType<typeof signBridgeRequestForPath>;
      try { proof = signBridgeRequestForPath(config.secret, body, NEXTCRM_ACCOUNT_CREATE_PATH); }
      catch { throw new NextcrmAccountLookupUnavailable(); }
      try {
        const response = await fetcher(new URL(NEXTCRM_ACCOUNT_CREATE_PATH, url), {
          method: 'POST', redirect: 'error', cache: 'no-store',
          signal: AbortSignal.timeout(config.timeoutMs ?? 3000),
          headers: {
            'content-type': 'application/json',
            'x-cisne-bridge-timestamp': proof.timestamp,
            'x-cisne-bridge-nonce': proof.nonce,
            'x-cisne-bridge-signature': proof.signature,
          }, body,
        });
        const raw = await response.text();
        if (![200, 201, 404].includes(response.status) || Buffer.byteLength(raw, 'utf8') > 2048 ||
            !verifyBridgeResponseForPath(config.secret, raw, response.status, proof,
              response.headers.get('x-cisne-bridge-response-signature') ?? '', NEXTCRM_ACCOUNT_CREATE_PATH)) {
          throw new NextcrmAccountLookupUnavailable();
        }
        if (response.status === 404) throw new NextcrmAccountLookupUnavailable();
        const value: unknown = JSON.parse(raw);
        if (!value || typeof value !== 'object') throw new NextcrmAccountLookupUnavailable();
        const x = value as Record<string, unknown>;
        if (x.authorized !== true || x.tenantKey !== tenantKey || x.erpClientId !== erpClientId ||
            typeof x.accountId !== 'string' || !UUID.test(x.accountId)) throw new NextcrmAccountLookupUnavailable();
        return { accountId: x.accountId, created: x.created === true };
      } catch (error) {
        if (error instanceof NextcrmAccountLookupUnavailable) throw error;
        throw new NextcrmAccountLookupUnavailable();
      }
    },
  };
}
