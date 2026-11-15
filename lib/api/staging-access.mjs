/**
 * @param {Request} request
 * @param {Record<string, string | undefined>} [env]
 * @returns {{status:number,code:string,message:string}|null}
 */
export function stagingBoundaryError(request, env = process.env) {
  const mode = env.CISNE_STAGING_ACCESS_MODE;
  const environment = env.RAILWAY_ENVIRONMENT_NAME;
  if (mode && environment !== 'staging') {
    return { status: 503, code: 'INVALID_STAGING_ACCESS_CONFIGURATION', message: 'A configuração de acesso de homologação é inválida neste ambiente.' };
  }
  if (environment !== 'staging') return null;
  // A request header (including a shared secret) is controlled by the caller and
  // cannot establish a trusted network boundary or identity. Fail closed until
  // Railway ingress is restricted to an authenticated gateway/private network.
  void request;
  return { status: 403, code: 'STAGING_PRIVATE_ACCESS_REQUIRED', message: 'Workspace disponível. APIs e operações aguardam um perímetro privado de homologação.' };
}
