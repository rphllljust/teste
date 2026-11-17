import { AsyncLocalStorage } from 'node:async_hooks';
import {
  isApprovedRC95UatMutation,
  isApprovedRC95UatWindow,
} from './staging-uat-mutation.mjs';

// Request-local data access capability. Never use an environment-only switch
// as permission for the database write pool.
const requestScope = new AsyncLocalStorage();

export function bindRC98DatabaseRequest(request, env=process.env, now=Date.now()) {
  const approved = isApprovedRC95UatMutation(request, env, now);
  requestScope.enterWith(Object.freeze({
    actor: approved ? env.CISNE_STAGING_ACTOR_ID : null,
    permittedAt: approved ? now : 0,
    permitExpiry: approved ? Number(env.CISNE_RC95_UAT_UNTIL_MS) : 0,
    signedPostPath: approved ? new URL(request.url).pathname : null,
    method: approved ? 'POST' : null,
  }));
  return approved;
}

export function rc98UatWritePoolAllowed(env=process.env,now=Date.now()) {
  const active = requestScope.getStore();
  return active?.method === 'POST' &&
    typeof active.signedPostPath === 'string' &&
    active.signedPostPath.startsWith('/api/') &&
    active.actor === env.CISNE_STAGING_ACTOR_ID &&
    active.permitExpiry === Number(env.CISNE_RC95_UAT_UNTIL_MS) &&
    Number.isFinite(active.permittedAt) &&
    active.permittedAt > 0 &&
    now >= active.permittedAt &&
    now - active.permittedAt <= 10000 &&
    isApprovedRC95UatWindow(env, now);
}

// Tests may inspect the scoped state, but no runtime path may grant it without
// a separately verified signed mutation. This is not a persisted nonce ledger.
