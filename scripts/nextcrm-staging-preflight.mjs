import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/**
 * Railway staging PRE-DEPLOY gate. Fail closed BEFORE the NextCRM application
 * starts. Only field names are logged, never secret values or database URLs.
 * This validates presence/format; DNS, verified email sender, backups and UAT
 * still require independent operator evidence.
 */
const HEX64 = /^[a-f0-9]{64}$/;
const BRIDGE_KEY = /^[a-f0-9]{64,128}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
// Staging has exactly one Railway-managed public hostname; the app must not
// issue redirects to localhost, private DNS or :3000.
export const PUBLIC_CRM_ORIGIN = 'https://nextcrm-gateway-staging.up.railway.app';

function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      !url.search && !url.hash && (url.pathname === '/' || url.pathname === '') &&
      !/\.(invalid|example|test)$/.test(url.hostname) && url.hostname.includes('.');
  } catch { return false; }
}

export function validateNextcrmStagingPredeploy(env) {
  const failures = [];
  function requireField(name, condition) { if (!condition) failures.push(name); }
  // RC85 private-only, synthetic-data Railway staging. This intentionally
  // CANNOT be used as production configuration or to reach the legacy DB/S3.
  if (env.CISNE_RC84_RAILWAY_BUCKET_MODE === 'true') {
    const isolatedBucket = /^rc84-nextcrm-isolated-objects-[a-z0-9]{4,16}$/;
    const databaseHost = 'nextcrm-rc84-isolated-pg.railway.internal';
    const privateAppUrl = 'http://localhost:3000';
    requireField('RAILWAY_ENVIRONMENT_NAME', env.RAILWAY_ENVIRONMENT_NAME === 'staging');
    requireField('NODE_ENV', env.NODE_ENV === 'production');
    requireField('PORT', env.PORT === '3000');
    requireField('CISNE_RC84_RAILWAY_BUCKET_MODE', env.CISNE_RC84_RAILWAY_BUCKET_MODE === 'true');
    requireField('CISNE_NEXTCRM_INSTANCE_KEY', env.CISNE_NEXTCRM_INSTANCE_KEY === 'rc84_isolated_hml');
    requireField('CISNE_NEXTCRM_BRIDGE_SECRET', BRIDGE_KEY.test(env.CISNE_NEXTCRM_BRIDGE_SECRET ?? ''));
    requireField('BETTER_AUTH_SECRET', typeof env.BETTER_AUTH_SECRET === 'string' &&
      env.BETTER_AUTH_SECRET.length >= 32);
    requireField('EMAIL_ENCRYPTION_KEY', HEX64.test(env.EMAIL_ENCRYPTION_KEY ?? ''));
    requireField('INNGEST_EVENT_KEY', HEX64.test(env.INNGEST_EVENT_KEY ?? ''));
    requireField('INNGEST_SIGNING_KEY', HEX64.test(env.INNGEST_SIGNING_KEY ?? ''));
    requireField('INNGEST_DEV', env.INNGEST_DEV === '1');
    requireField('INNGEST_BASE_URL', !env.INNGEST_BASE_URL);
    requireField('SEED_DEMO_DATA', env.SEED_DEMO_DATA === '0');
    const bucket = env.MINIO_BUCKET ?? '';
    requireField('MINIO_BUCKET', isolatedBucket.test(bucket));
    let internalS3;
    let publicS3;
    try { internalS3 = new URL(env.MINIO_ENDPOINT); } catch {}
    try { publicS3 = new URL(env.MINIO_PUBLIC_ENDPOINT); } catch {}
    const allowedEndpoints = new Set(['storage.railway.app','t3.storageapi.dev']);
    const safeS3=(value) => value?.protocol === 'https:' &&
      allowedEndpoints.has(value.hostname) && !value.port &&
      !value.username && !value.password &&
      (value.pathname === '/' || value.pathname === '') &&
      !value.search && !value.hash;
    requireField('MINIO_ENDPOINT', safeS3(internalS3));
    requireField('MINIO_PUBLIC_ENDPOINT', safeS3(publicS3) &&
      internalS3?.origin === publicS3?.origin);
    requireField('MINIO_ACCESS_KEY', typeof env.MINIO_ACCESS_KEY === 'string' &&
      env.MINIO_ACCESS_KEY.length >= 3);
    requireField('MINIO_SECRET_KEY', typeof env.MINIO_SECRET_KEY === 'string' &&
      env.MINIO_SECRET_KEY.length >= 24);
    for (const key of ['BETTER_AUTH_URL','APP_URL','NEXT_PUBLIC_APP_URL']) {
      requireField(key, env[key] === privateAppUrl);
    }
    // No verified domain or transactional mail is connected to this instance.
    // A real customer session or email must not be created in this phase.
    requireField('EMAIL_FROM', env.EMAIL_FROM === 'rc84-no-send@example.invalid');
    requireField('TEST_USER_EMAIL', env.TEST_USER_EMAIL === 'rc84-only@example.invalid');
    requireField('RESEND_API_KEY', !env.RESEND_API_KEY);
    let url;
    try { url = new URL(env.DATABASE_URL); } catch {}
    requireField('DATABASE_URL', url?.protocol === 'postgresql:' &&
      url.hostname === databaseHost && url.port === '5432' &&
      url.username === 'nextcrm' && url.pathname === '/nextcrm_rc84' &&
      Boolean(url.password) && !url.search && !url.hash &&
      decodeURIComponent(url.password) === env.DB_PASSWORD);
    requireField('DB_HOST', env.DB_HOST === databaseHost);
    requireField('DB_USER', env.DB_USER === 'nextcrm');
    requireField('DB_NAME', env.DB_NAME === 'nextcrm_rc84');
    requireField('DB_PORT', env.DB_PORT === '5432');
    requireField('DB_PASSWORD', typeof env.DB_PASSWORD === 'string' &&
      env.DB_PASSWORD.length >= 24);
    return failures.sort();
  }
  // The legacy preflight must reject unexpected experimental mode strings.
  requireField('CISNE_RC84_RAILWAY_BUCKET_MODE', !env.CISNE_RC84_RAILWAY_BUCKET_MODE ||
    env.CISNE_RC84_RAILWAY_BUCKET_MODE === 'false');
  requireField('RAILWAY_ENVIRONMENT_NAME', env.RAILWAY_ENVIRONMENT_NAME === 'staging');
  requireField('NODE_ENV', env.NODE_ENV === 'production');
  requireField('PORT', env.PORT === '3000');
  requireField('CISNE_NEXTCRM_INSTANCE_KEY', env.CISNE_NEXTCRM_INSTANCE_KEY === 'cisne-hml-2026');
  requireField('CISNE_NEXTCRM_BRIDGE_SECRET', BRIDGE_KEY.test(env.CISNE_NEXTCRM_BRIDGE_SECRET ?? ''));
  requireField('BETTER_AUTH_SECRET', typeof env.BETTER_AUTH_SECRET === 'string' && env.BETTER_AUTH_SECRET.length >= 32);
  requireField('EMAIL_ENCRYPTION_KEY', HEX64.test(env.EMAIL_ENCRYPTION_KEY ?? ''));
  requireField('INNGEST_EVENT_KEY', HEX64.test(env.INNGEST_EVENT_KEY ?? ''));
  requireField('INNGEST_SIGNING_KEY', HEX64.test(env.INNGEST_SIGNING_KEY ?? ''));
  requireField('INNGEST_BASE_URL', env.INNGEST_BASE_URL === 'http://nextcrm-jobs.railway.internal:8288');
  requireField('INNGEST_DEV', env.INNGEST_DEV === '0');
  requireField('SEED_DEMO_DATA', env.SEED_DEMO_DATA === '0');
  requireField('MINIO_ENDPOINT', env.MINIO_ENDPOINT === 'http://nextcrm-minio.railway.internal:9000');
  requireField('MINIO_BUCKET', env.MINIO_BUCKET === 'nextcrm');
  requireField('MINIO_ACCESS_KEY', typeof env.MINIO_ACCESS_KEY === 'string' && env.MINIO_ACCESS_KEY.length >= 3);
  requireField('MINIO_SECRET_KEY', typeof env.MINIO_SECRET_KEY === 'string' && env.MINIO_SECRET_KEY.length >= 24);
  requireField('MINIO_PUBLIC_ENDPOINT', httpsUrl(env.MINIO_PUBLIC_ENDPOINT));
  requireField('BETTER_AUTH_URL', env.BETTER_AUTH_URL === PUBLIC_CRM_ORIGIN);
  requireField('APP_URL', env.APP_URL === PUBLIC_CRM_ORIGIN);
  requireField('NEXT_PUBLIC_APP_URL', env.NEXT_PUBLIC_APP_URL === PUBLIC_CRM_ORIGIN);
  requireField('RESEND_API_KEY', typeof env.RESEND_API_KEY === 'string' && /^re_[A-Za-z0-9_-]{8,}$/.test(env.RESEND_API_KEY));
  requireField('EMAIL_FROM', EMAIL.test(env.EMAIL_FROM ?? '') && !/\.(invalid|example|test)$/i.test((env.EMAIL_FROM ?? '').split('@')[1] ?? ''));
  requireField('TEST_USER_EMAIL', EMAIL.test(env.TEST_USER_EMAIL ?? '') && !/\.(invalid|example|test)$/i.test((env.TEST_USER_EMAIL ?? '').split('@')[1] ?? ''));
  let parsed;
  try { parsed = new URL(env.DATABASE_URL); } catch {}
  requireField('DATABASE_URL', parsed?.protocol === 'postgresql:' &&
    parsed.hostname === 'nextcrm-postgres.railway.internal' && parsed.port === '5432' &&
    parsed.username === 'nextcrm' && parsed.pathname === '/nextcrm' && Boolean(parsed.password) &&
    !parsed.search && !parsed.hash);
  requireField('DB_HOST', env.DB_HOST === 'nextcrm-postgres.railway.internal');
  requireField('DB_USER', env.DB_USER === 'nextcrm');
  requireField('DB_NAME', env.DB_NAME === 'nextcrm');
  requireField('DB_PORT', env.DB_PORT === '5432');
  requireField('DB_PASSWORD', typeof env.DB_PASSWORD === 'string' && env.DB_PASSWORD.length >= 24);
  return failures.sort();
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = validateNextcrmStagingPredeploy(process.env);
  if (problems.length) {
    console.error('NO-GO NextCRM staging pre-deploy: missing/invalid field names: ' + problems.join(', '));
    process.exitCode = 1;
  } else {
    console.log('PASS: NextCRM staging environment field formats verified. Backup, email sender, DNS/TLS and UAT still require independent evidence.');
  }
}
