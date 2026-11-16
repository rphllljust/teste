/**
 * Public Railway domains are directly reachable by arbitrary HTTP clients.
 * An oai-authenticated-user-id header is not an authentication mechanism:
 * only the trusted Sites dispatch may inject that header.
 *
 * Until an independently verified identity provider is implemented, all
 * business APIs on non-staging Railway deployments must fail closed.
 * Staging has its own signed-cookie policy; NODE_ENV=test uses in-process
 * identities in isolated CI, never browser-provided headers.
 */
export function railwayIdentityBoundaryError(env = process.env) {
  const railway = Boolean(
    env.RAILWAY_PROJECT_ID || env.RAILWAY_SERVICE_ID ||
    env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_SERVICE_NAME ||
    env.RAILWAY_PROJECT_NAME,
  );
  if (!railway) return null;
  const environment = env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_ENVIRONMENT;
  if (environment === 'staging') return null;
  return {
    status: 503,
    code: 'RAILWAY_TRUSTED_IDENTITY_REQUIRED',
    message: 'Operação indisponível até que a identidade do operador seja verificada.',
  };
}
