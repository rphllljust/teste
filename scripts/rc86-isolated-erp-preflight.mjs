import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Strict, read-only predeploy configuration gate for the NEW disposable ERP.
 * It never queries a database, writes migrations, provisions identities,
 * logs variable values, or changes the legacy/prod service.
 */
const STAGING_PROJECT = '0835d357-6037-42e6-a534-6456422e1cf3';
const STAGING_ENVIRONMENT = 'c241a855-68b7-4d75-a722-b6a42c8581e9';
const ERP_SERVICE = 'fed95ca7-f373-4e6a-983f-2f591f26672e';
const ERP_POSTGRES = 'cisne-rc85-ephemeral-pg.railway.internal';
const ISOLATED_NEXTCRM = 'http://nextcrm-rc84-isolated-web.railway.internal:3000';
const BUCKET = /^rc84-nextcrm-isolated-objects-[a-z0-9]{4,16}$/;
const BRIDGE_SECRET = /^[a-f0-9]{64,128}$/;

export function validateRC86IsolatedErpPredeploy(env) {
  const failures = [];
  const requireField = (key, valid) => { if (!valid) failures.push(key); };

  requireField('RAILWAY_PROJECT_ID', env.RAILWAY_PROJECT_ID === STAGING_PROJECT);
  requireField('RAILWAY_ENVIRONMENT_ID', env.RAILWAY_ENVIRONMENT_ID === STAGING_ENVIRONMENT);
  requireField('RAILWAY_ENVIRONMENT_NAME', env.RAILWAY_ENVIRONMENT_NAME === 'staging');
  requireField('RAILWAY_SERVICE_ID', env.RAILWAY_SERVICE_ID === ERP_SERVICE);
  requireField('RAILWAY_SERVICE_NAME', env.RAILWAY_SERVICE_NAME === 'cisne-rc85-ephemeral-erp');
  requireField('NODE_ENV', env.NODE_ENV === 'production');
  requireField('PORT', /^[0-9]{2,5}$/.test(env.PORT ?? '') &&
    Number(env.PORT) > 0 && Number(env.PORT) <= 65535);

  requireField('CISNE_RAILWAY_WORKER_BINDINGS', env.CISNE_RAILWAY_WORKER_BINDINGS === 'restricted');
  requireField('CLOUDFLARE_INCLUDE_PROCESS_ENV', env.CLOUDFLARE_INCLUDE_PROCESS_ENV !== 'true');
  requireField('CISNE_STAGING_ACCESS_MODE', env.CISNE_STAGING_ACCESS_MODE === 'private');
  requireField('CISNE_STAGING_READ_ONLY', env.CISNE_STAGING_READ_ONLY === 'true');
  requireField('CISNE_STAGING_PUBLIC_ORIGIN', !env.CISNE_STAGING_PUBLIC_ORIGIN);
  requireField('CISNE_STAGING_LOGIN_HASH', !env.CISNE_STAGING_LOGIN_HASH);
  requireField('CISNE_STAGING_UAT', !env.CISNE_STAGING_UAT || env.CISNE_STAGING_UAT === 'false');
  requireField('CISNE_STAGING_ACTOR_ID', typeof env.CISNE_STAGING_ACTOR_ID === 'string' &&
    env.CISNE_STAGING_ACTOR_ID.length >= 8);
  requireField('CISNE_STAGING_SESSION_SECRET',
    typeof env.CISNE_STAGING_SESSION_SECRET === 'string' &&
    env.CISNE_STAGING_SESSION_SECRET.length >= 32);

  requireField('CISNE_RC84_RAILWAY_BUCKET_MODE', env.CISNE_RC84_RAILWAY_BUCKET_MODE === 'true');
  requireField('CISNE_NEXTCRM_PRIVATE_ORIGIN', env.CISNE_NEXTCRM_PRIVATE_ORIGIN === ISOLATED_NEXTCRM);
  requireField('CISNE_NEXTCRM_INSTANCE_KEY', env.CISNE_NEXTCRM_INSTANCE_KEY === 'rc84_isolated_hml');
  requireField('CISNE_NEXTCRM_BRIDGE_SECRET',
    BRIDGE_SECRET.test(env.CISNE_NEXTCRM_BRIDGE_SECRET ?? ''));

  const bucket = env.CISNE_NEXTCRM_MINIO_BUCKET ?? '';
  requireField('CISNE_NEXTCRM_MINIO_BUCKET', BUCKET.test(bucket));
  let storageOrigin;
  try { storageOrigin = new URL(env.CISNE_NEXTCRM_MINIO_PUBLIC_ORIGIN); } catch {}
  requireField('CISNE_NEXTCRM_MINIO_PUBLIC_ORIGIN',
    BUCKET.test(bucket) && storageOrigin?.protocol === 'https:' &&
    !storageOrigin.username && !storageOrigin.password && !storageOrigin.port &&
    (storageOrigin.pathname === '/' || storageOrigin.pathname === '') &&
    !storageOrigin.search && !storageOrigin.hash &&
    (storageOrigin.hostname === bucket + '.storage.railway.app' ||
     storageOrigin.hostname === bucket + '.t3.storageapi.dev'));

  let database;
  try { database = new URL(env.DATABASE_URL); } catch {}
  requireField('DATABASE_URL',
    (database?.protocol === 'postgres:' || database?.protocol === 'postgresql:') &&
    database.hostname === ERP_POSTGRES && database.port === '5432' &&
    database.pathname === '/cisne_rc85' &&
    Boolean(database.username) && database.username !== 'nextcrm' &&
    Boolean(database.password) && !database.search && !database.hash);

  return failures.sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = validateRC86IsolatedErpPredeploy(process.env);
  if (failures.length) {
    console.error('NO-GO isolated ERP predeploy: invalid configuration names: ' + failures.join(', '));
    process.exitCode = 1;
  } else {
    console.log('PASS: isolated read-only ERP staging configuration matches reviewed service and destinations.');
  }
}
