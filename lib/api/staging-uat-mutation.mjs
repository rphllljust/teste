import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { validateStagingSession } from './staging-session.mjs';

// RC95: opt-in, ephemeral, *additional* credential for synthetic Railway UAT.
// The global staging read-only setting MUST remain true. This admits only
// a narrow set of POST handlers for a signed staging actor, and expires even
// if an operator forgets to remove the variables. No production override.
const APPROVED = Object.freeze({
  project: '0835d357-6037-42e6-a534-6456422e1cf3',
  environment: 'c241a855-68b7-4d75-a722-b6a42c8581e9',
  service: 'fed95ca7-f373-4e6a-983f-2f591f26672e',
});

const ROUTES = Object.freeze([
  /^\/api\/clients$/,
  /^\/api\/orders$/,
  /^\/api\/orders\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/documents$/,
  /^\/api\/commands$/,
  /^\/api\/finance\/receivables\/settlements$/,
  /^\/api\/finance\/receivables\/settlements\/[0-9a-f-]{36}\/reverse$/,
  /^\/api\/finance\/periods\/close$/,
]);

const isHex = (value, length) =>
  typeof value === 'string' &&
  value.length === length &&
  /^[a-f0-9]+$/.test(value);

const isApprovedConfig = (env, now) => {
  const until = Number(env.CISNE_RC95_UAT_UNTIL_MS);
  return env.RAILWAY_PROJECT_ID === APPROVED.project &&
    env.RAILWAY_ENVIRONMENT_ID === APPROVED.environment &&
    env.RAILWAY_ENVIRONMENT_NAME === 'staging' &&
    env.RAILWAY_SERVICE_ID === APPROVED.service &&
    env.RAILWAY_SERVICE_NAME === 'cisne-rc85-ephemeral-erp' &&
    env.CISNE_STAGING_READ_ONLY === 'true' &&
    env.CISNE_STAGING_ACCESS_MODE === 'private' &&
    env.CISNE_RC95_UAT_ENABLED === 'true' &&
    typeof env.CISNE_STAGING_ACTOR_ID === 'string' &&
    env.CISNE_STAGING_ACTOR_ID.length >= 8 &&
    env.CISNE_RC95_UAT_ACTOR_ID === env.CISNE_STAGING_ACTOR_ID &&
    typeof env.CISNE_RC95_UAT_SIGNING_KEY === 'string' &&
    isHex(env.CISNE_RC95_UAT_SIGNING_KEY, 64) &&
    Number.isSafeInteger(until) && until > now &&
    until - now <= 10 * 60 * 1000;
};

function signedPayload(request, actor, millis, nonce) {
  const url = new URL(request.url);
  return [
    'rc95/v1', request.method, url.pathname,
    String(millis), nonce, actor, APPROVED.environment,
  ].join('\n');
}

export function issueRC95UatToken(request, actor, key, now=Date.now()) {
  const nonce = randomBytes(16).toString('hex');
  const raw = signedPayload(request, actor, now, nonce);
  const signature = createHmac('sha256', key).update(raw).digest('hex');
  return ['v1', String(now), nonce, signature].join('.');
}

export function isApprovedRC95UatMutation(request, env=process.env, now=Date.now()) {
  try {
    if (!isApprovedConfig(env, now) || request.method !== 'POST') return false;
    const url = new URL(request.url);
    if (url.search || !ROUTES.some(route => route.test(url.pathname))) return false;
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
      return false;
    const actor = validateStagingSession(request, env, now);
    if (!actor || actor !== env.CISNE_RC95_UAT_ACTOR_ID) return false;
    const header = request.headers.get('x-cisne-rc95-uat');
    if (!header || header.length > 192) return false;
    const pieces = header.split('.');
    if (pieces.length !== 4 || pieces[0] !== 'v1' ||
        !/^\d{13}$/.test(pieces[1]) ||
        !isHex(pieces[2], 32) || !isHex(pieces[3], 64)) return false;
    const timestamp = Number(pieces[1]);
    // Very small replay window. Business commands additionally require
    // application-level idempotency keys; this is NOT a durable nonce ledger.
    if (!Number.isSafeInteger(timestamp) || Math.abs(timestamp - now) > 10000)
      return false;
    const expected = createHmac('sha256', env.CISNE_RC95_UAT_SIGNING_KEY)
      .update(signedPayload(request, actor, timestamp, pieces[2]))
      .digest();
    const supplied = Buffer.from(pieces[3], 'hex');
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  } catch { return false; }
}
