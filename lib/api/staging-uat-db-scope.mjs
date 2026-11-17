import { AsyncLocalStorage } from 'node:async_hooks';
import { isApprovedRC95UatMutation, isApprovedRC95UatWindow } from './staging-uat-mutation.mjs';

// Cloudflare Worker supports AsyncLocalStorage.run(), not enterWith().
// Scope must wrap the full async handler, never be installed by a sync
// auth-check function that simply returns to its caller.
const requestScope = new AsyncLocalStorage();

/**
 * The entire handler runs in this async context. Signed business requests
 * receive a temporary write capability; all others receive NONE.
 * This is always an additional restriction to HTTP requestContext().
 */
export function withRC98SignedDbScope(request, handler, env=process.env, now=Date.now()) {
  const approved = isApprovedRC95UatMutation(request, env, now);
  const scope = Object.freeze({
    actor: approved ? env.CISNE_STAGING_ACTOR_ID : null,
    permittedAt: approved ? now : 0,
    permitExpiry: approved ? Number(env.CISNE_RC95_UAT_UNTIL_MS) : 0,
    signedPostPath: approved ? new URL(request.url).pathname : null,
    method: approved ? 'POST' : null,
  });
  return requestScope.run(scope, handler);
}

export function rc98UatWritePoolAllowed(env=process.env, now=Date.now()) {
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
