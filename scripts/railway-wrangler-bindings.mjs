import { readFileSync, writeFileSync } from 'node:fs';

const APPROVED_WORKER_KEYS = Object.freeze([
  'DATABASE_URL',
  'NODE_ENV',
  'PGPOOL_MAX',
  'RAILWAY_PROJECT_ID',
  'RAILWAY_ENVIRONMENT_ID',
  'RAILWAY_ENVIRONMENT_NAME',
  'RAILWAY_SERVICE_ID',
  'RAILWAY_PUBLIC_DOMAIN',
  'RAILWAY_PRIVATE_DOMAIN',
  'CISNE_STAGING_ACCESS_MODE',
  'CISNE_STAGING_READ_ONLY',
  'CISNE_STAGING_UAT',
  'CISNE_STAGING_ACTOR_ID',
  'CISNE_STAGING_PUBLIC_ORIGIN',
  'CISNE_STAGING_LOGIN_HASH',
  'CISNE_STAGING_SESSION_SECRET',
  'CISNE_NEXTCRM_PUBLIC_URL',
  'CISNE_NEXTCRM_BRIDGE_SECRET',
  'CISNE_NEXTCRM_INSTANCE_KEY',
  'CISNE_NEXTCRM_PRIVATE_ORIGIN',
  'CISNE_RC84_RAILWAY_BUCKET_MODE',
  'CISNE_NEXTCRM_MINIO_BUCKET',
  'CISNE_NEXTCRM_MINIO_PUBLIC_ORIGIN',
]);

/**
 * Railway starts a Node wrapper that launches Wrangler's local Worker.
 * Host process.env is NOT automatically copied into the Worker.
 * Wrangler's secrets.required loads the selected values from process.env.
 *
 * This writes only binding NAMES to the generated runtime config, never values.
 * No console output may include DSNs, secrets or environment variable values.
 * Only an explicitly approved, read-only staging service may opt in.
 */
export function configureRestrictedRailwayWorkerBindings(configPath, env = process.env) {
  if (env.CISNE_RAILWAY_WORKER_BINDINGS !== 'restricted') return 0;
  if (env.CLOUDFLARE_INCLUDE_PROCESS_ENV === 'true')
    throw new Error('NO-GO: unrestricted Worker environment import is prohibited');
  if (env.RAILWAY_ENVIRONMENT_NAME !== 'staging' ||
      !env.RAILWAY_PROJECT_ID || !env.RAILWAY_SERVICE_ID ||
      env.CISNE_STAGING_READ_ONLY !== 'true') {
    throw new Error('NO-GO: restricted runtime bindings require isolated Railway staging read-only');
  }
  if (typeof env.DATABASE_URL !== 'string' || env.DATABASE_URL.length < 12) {
    throw new Error('NO-GO: PostgreSQL URL is absent in Railway host environment');
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  if (!config || typeof config !== 'object' || typeof config.main !== 'string')
    throw new Error('NO-GO: generated Wrangler config is invalid');
  const existing = Array.isArray(config.secrets?.required)
    ? config.secrets.required.filter(key => typeof key === 'string') : [];
  const selected = APPROVED_WORKER_KEYS.filter(name =>
    typeof env[name] === 'string' && env[name].length > 0);
  config.secrets = {
    ...config.secrets,
    required: [...new Set([...existing, ...selected])].sort(),
  };
  // File contains only names; actual secret values stay in Railway runtime.
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  return selected.length;
}
