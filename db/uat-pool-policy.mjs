import { rc98UatWritePoolAllowed } from '../lib/api/staging-uat-db-scope.mjs';

/**
 * Only the post-requestContext signed synthetic HMAC scope can authorize
 * a short-lived SQL writer. Merely setting an environment toggle cannot.
 * Normal staging remains read-only at both HTTP and SQL layers.
 */
export function rc98PgPoolMode(env=process.env,now=Date.now()) {
  const stagingReadOnly = env.RAILWAY_ENVIRONMENT_NAME==='staging' &&
    env.CISNE_STAGING_READ_ONLY==='true';
  if (!stagingReadOnly) return Object.freeze({mode:'normal',options:null,max:undefined});
  if (rc98UatWritePoolAllowed(env,now))
    return Object.freeze({mode:'synthetic-write',options:'-c default_transaction_read_only=off',max:1});
  return Object.freeze({mode:'read-only',options:'-c default_transaction_read_only=on',max:undefined});
}
