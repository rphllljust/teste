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
  const secret = env.CISNE_TRUSTED_DISPATCH_SECRET;
  const presented = request.headers.get('x-cisne-dispatch-secret');
  if (mode !== 'private' || !secret || !presented || presented.length !== secret.length || presented !== secret) {
    return { status: 403, code: 'STAGING_PRIVATE_ACCESS_REQUIRED', message: 'Workspace disponível. APIs e operações aguardam um perímetro privado de homologação.' };
  }
  return null;
}
