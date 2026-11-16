import { validateStagingSession } from './staging-session.mjs';
/**
 * @param {Request} request
 * @param {Record<string, string | undefined>} [env]
 * @returns {{status:number,code:string,message:string}|null}
 */
export function stagingBoundaryError(request, env = process.env) {
  const mode = env.CISNE_STAGING_ACCESS_MODE;
  const environment = env.RAILWAY_ENVIRONMENT_NAME;
  if ((mode || env.CISNE_STAGING_READ_ONLY === 'true') && environment !== 'staging') {
    return { status: 503, code: 'INVALID_STAGING_ACCESS_CONFIGURATION', message: 'A configuração de acesso de homologação é inválida neste ambiente.' };
  }
  if (environment !== 'staging') return null;
  // Preview instances share infrastructure for read verification only.
  // Reject writes regardless of cookie, user identity or HTTP Origin.
  if (env.CISNE_STAGING_READ_ONLY === 'true' &&
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    return { status: 403, code: 'STAGING_READ_ONLY_PREVIEW',
      message: 'Prévia de homologação em modo somente leitura.' };
  }
  // Browser-provided identity headers are NEVER trusted in public staging.
  // Only a server-HMAC-verified, expiring, HttpOnly session can cross this boundary.
  if(validateStagingSession(request,env))return null;
  return { status: 403, code: 'STAGING_PRIVATE_ACCESS_REQUIRED', message: 'Acesse o ambiente de homologação com sua credencial autorizada.' };
}
