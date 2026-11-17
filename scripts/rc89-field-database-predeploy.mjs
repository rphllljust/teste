import { Client } from 'pg';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRC86IsolatedErpPredeploy } from './rc86-isolated-erp-preflight.mjs';

// Read-only connection identity verification run AFTER the RC86 environment gate.
// This gate does not infer durable storage from SQL: the existing RC75 PG18
// volume was separately verified in Railway and the database provision audit.
export function assessRC89FieldIdentity(row) {
  const errors = [];
  const check = (key, valid) => { if (!valid) errors.push(key); };
  check('DB_NAME', row?.field_database === true);
  check('DB_ROLE', row?.field_role === true);
  check('DB_OWNER', row?.field_owner === true);
  check('DB_POSTGRES18', row?.postgres18 === true);
  check('DB_PRIMARY', row?.primary === true);
  check('DB_LEAST_PRIVILEGED', row?.role_limited === true);
  return errors.sort();
}

export async function verifyRC89FieldDatabase(env, ClientConstructor = Client) {
  const configErrors = validateRC86IsolatedErpPredeploy(env);
  if (configErrors.length) return configErrors.map(name => 'CONFIG_' + name);
  let client, errors = [];
  try {
    // Force all SQL in this predeploy to be read-only, with bounded timeouts.
    client = new ClientConstructor({
      connectionString: env.DATABASE_URL,
      options: '-c default_transaction_read_only=on -c statement_timeout=3500',
      connectionTimeoutMillis: 4500,
      query_timeout: 4500,
    });
    await client.connect();
    const result = await client.query(`
      SELECT current_database() = 'cisne_rc89_field' AS field_database,
             current_user = 'cisne_rc89_field_app' AS field_role,
             (SELECT pg_get_userbyid(datdba) = current_user
                FROM pg_database WHERE datname = current_database()) AS field_owner,
             (current_setting('server_version_num')::int / 10000) = 18 AS postgres18,
             NOT pg_is_in_recovery() AS primary,
             (SELECT NOT (rolsuper OR rolcreatedb OR rolcreaterole OR
                           rolreplication OR rolbypassrls)
                FROM pg_roles WHERE rolname = current_user) AS role_limited
    `);
    errors = Array.isArray(result?.rows) && result.rows.length === 1
      ? assessRC89FieldIdentity(result.rows[0]) : ['DB_RESULT_INVALID'];
  } catch {
    errors = ['DB_CONNECT_OR_READ_FAILED'];
  } finally {
    if (client) {
      try { await client.end(); }
      catch { errors.push('DB_CLIENT_CLOSE_FAILED'); }
    }
  }
  return [...new Set(errors)].sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = await verifyRC89FieldDatabase(process.env);
  if (failures.length) {
    console.error('RC89_EXISTING_VOLUME_FIELD_DB_NO_GO: ' + failures.join(','));
    process.exitCode = 1;
  } else {
    console.log('RC89_FIELD_DATABASE_IDENTITY_PASS: dedicated role/database inside approved persisted PostgreSQL18.');
    console.log('RC89_REMAINING_GATES: backup/restore, source-controlled migrations, readiness and business UAT.');
  }
}
