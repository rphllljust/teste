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
  requireField('BETTER_AUTH_URL', httpsUrl(env.BETTER_AUTH_URL));
  requireField('NEXT_PUBLIC_APP_URL', httpsUrl(env.NEXT_PUBLIC_APP_URL) &&
    env.NEXT_PUBLIC_APP_URL === env.BETTER_AUTH_URL);
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
