import { validateStagingSession } from './staging-session.mjs';
import { getTestIdentity } from './test-identity.mjs';

// These are server-provisioned environment variables, not client headers.
// Railway can omit RAILWAY_ENVIRONMENT_NAME in some preview/custom deployments.
const RAILWAY_MARKERS = [
  'RAILWAY_PROJECT_ID',
  'RAILWAY_ENVIRONMENT_ID',
  'RAILWAY_ENVIRONMENT_NAME',
  'RAILWAY_SERVICE_ID',
  'RAILWAY_PUBLIC_DOMAIN',
  'RAILWAY_PRIVATE_DOMAIN',
];

export function isRailwayRuntime(env = process.env) {
  return RAILWAY_MARKERS.some(name =>
    typeof env[name] === 'string' && env[name].length > 0
  );
}

/**
 * A browser-controlled identity header is NOT an authentication credential.
 * Production Railway has no verified identity provider yet: deny by default.
 * Staging uses a signed, HttpOnly cookie; test runners use an in-process WeakMap.
 * A future OIDC/SSO integration must verify its token before returning an actor.
 */
export function resolveRequestActor(request, env = process.env) {
  if (env.RAILWAY_ENVIRONMENT_NAME === 'staging') {
    return validateStagingSession(request, env);
  }
  if (isRailwayRuntime(env)) return null;

  // Test identity cannot be forged over HTTP: it is attached to Request in
  // this process only, and unavailable in Railway, even if NODE_ENV is 'test'.
  if (env.NODE_ENV === 'test' && process.env.NODE_ENV === 'test') {
    return getTestIdentity(request) ?? null;
  }
  return null;
}
