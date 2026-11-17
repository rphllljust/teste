import { validateStagingSession } from './staging-session.mjs';
import { bindRC98DatabaseRequest } from './staging-uat-db-scope.mjs';
/**
 * @param {Request} request
 * @param {Record<string, string | undefined>} [env]
 * @returns {{status:number,code:string,message:string}|null}
 */
export function stagingBoundaryError(request, env = process.env) {
  // Establish a fresh request-local deny-by-default DB scope even for GET.
  // A signed synthetic POST is the ONLY route to an RC98 write capability.
  const signedSyntheticMutation = bindRC98DatabaseRequest(request, env);
  const mode = env.CISNE_STAGING_ACCESS_MODE;
  const environment = env.RAILWAY_ENVIRONMENT_NAME;
  if ((mode || env.CISNE_STAGING_READ_ONLY === 'true') && environment !== 'staging') {
    return { status: 503, code: 'INVALID_STAGING_ACCESS_CONFIGURATION', message: 'A configuração de acesso de homologação é inválida neste ambiente.' };
  }
  if (environment !== 'staging') return null;
  // Read-only remains enabled. The sole exception is a narrowly scoped,
  // short-lived, doubly authenticated synthetic UAT request. Never permit
  // arbitrary authenticated mutations or any public/production override.
  if (env.CISNE_STAGING_READ_ONLY === 'true' &&
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      !signedSyntheticMutation) {
    return { status: 403, code: 'STAGING_READ_ONLY_PREVIEW',
      message: 'Prévia de homologação em modo somente leitura.' };
  }
  // Browser-provided identity headers are NEVER trusted in public staging.
  // Only a server-HMAC-verified, expiring, HttpOnly session can cross this boundary.
  if(validateStagingSession(request,env))return null;
  return { status: 403, code: 'STAGING_PRIVATE_ACCESS_REQUIRED', message: 'Acesse o ambiente de homologação com sua credencial autorizada.' };
}
