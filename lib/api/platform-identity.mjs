/**
 * Sites injects authenticated identity headers through its trusted dispatch.
 * Railway HTTP clients can send arbitrary headers with those same names.
 * Until an independent Railway session verifier is implemented, reject
 * requests that would otherwise treat those headers as authentication.
 *
 * Never accept a caller-supplied request header as evidence of platform trust.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @returns {boolean}
 */
export function requiresIndependentIdentity(env = process.env) {
  return Boolean(
    env.RAILWAY_PROJECT_ID ||
    env.RAILWAY_ENVIRONMENT_ID ||
    env.RAILWAY_SERVICE_ID ||
    env.CISNE_TARGET_PLATFORM === 'railway'
  );
}
