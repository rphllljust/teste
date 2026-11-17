import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { normalizeSql } from './raw-sql.mjs';
import { workerSafePoolMaxUses } from './worker-pool-policy.mjs';
import { rc98UatWritePoolAllowed } from '../lib/api/staging-uat-db-scope.mjs';

type BoundStatement = { sql: string; params: unknown[] };
type SqlRowsResult<T = Record<string, unknown>> = { results: T[]; success: true; meta: { changes: number } };
let pool: Pool | undefined;
let rc98UatPool: Pool | undefined;

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  // All normal staging requests continue to use the SQL-level read-only pool.
  // Only a request-local, HMAC-validated, unexpired RC95 synthetic POST may
  // select the separate one-connection PG writer pool. An environment flag,
  // session cookie or JWT alone is NEVER sufficient to select the writer.
  const readOnly = process.env.RAILWAY_ENVIRONMENT_NAME === 'staging' &&
    process.env.CISNE_STAGING_READ_ONLY === 'true';
  const temporaryWriter = readOnly && rc98UatWritePoolAllowed(process.env);
  const options = readOnly
    ? temporaryWriter
      ? '-c default_transaction_read_only=off'
      : '-c default_transaction_read_only=on'
    : undefined;
  if (temporaryWriter && rc98UatPool) return rc98UatPool;
  if (!temporaryWriter && pool) return pool;
  const created = new Pool({ connectionString: process.env.DATABASE_URL,
    ...(options ? { options } : {}),
    max: temporaryWriter ? 1 : Number(process.env.PGPOOL_MAX ?? 10),
    connectionTimeoutMillis: 5000,
    // Never reuse an UAT client between requests, and preserve existing
    // Worker maxUses=1 for all production/staging requests.
    idleTimeoutMillis: temporaryWriter ? 1000 : 30000,
    maxUses: temporaryWriter ? 1 : workerSafePoolMaxUses(process.env),
  });
  if (temporaryWriter) rc98UatPool = created;
  else pool = created;
  return created;
}

class Statement {
  constructor(private readonly sql: string) {}
  bind(...params: unknown[]) {
    const bound: BoundStatement = { sql: this.sql, params };
    return {
      first: async <T extends QueryResultRow = Record<string, unknown>>(): Promise<T | null> => { const result = await getPool().query<T>(normalizeSql(bound.sql, undefined, bound.params.length), bound.params); return result.rows[0] ?? null; },
      all: async <T extends QueryResultRow = Record<string, unknown>>(): Promise<SqlRowsResult<T>> => { const result = await getPool().query<T>(normalizeSql(bound.sql, undefined, bound.params.length), bound.params); return { results: result.rows, success: true, meta: { changes: result.rowCount ?? 0 } }; },
      run: async (): Promise<{ success: true; meta: { changes: number } }> => { const result = await getPool().query(normalizeSql(bound.sql, undefined, bound.params.length), bound.params); return { success: true, meta: { changes: result.rowCount ?? 0 } }; },
      _bound: bound,
    };
  }
}

function clientStatement(client: PoolClient, statement: BoundStatement, previousChanges: number) { return client.query(normalizeSql(statement.sql, previousChanges, statement.params.length), statement.params); }

export function database() {
  return {
    prepare(sql: string) { return new Statement(sql); },
    async batch(statements: Array<{ _bound?: BoundStatement }>) {
      const client = await getPool().connect();
      const results: Array<SqlRowsResult> = [];
      let previousChanges = 0;
      try {
        await client.query('BEGIN');
        for (const statement of statements) {
          if (!statement._bound) throw new Error('Unbound statement passed to database.batch');
          const result: QueryResult = await clientStatement(client, statement._bound, previousChanges);
          previousChanges = result.rowCount ?? 0;
          results.push({ results: result.rows, success: true, meta: { changes: previousChanges } });
        }
        await client.query('COMMIT');
        return results;
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    },
    async transaction<T>(work: (query: (sql: string, params?: unknown[]) => Promise<QueryResult>) => Promise<T>): Promise<T> {
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        const result = await work((sql, params = []) => client.query(sql, params));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    },
  };
}

/**
 * Trusted server-only pool for transactional NextCRM bridge adapters.
 * Do not import this module into client components or expose raw SQL to HTTP.
 */
export function databasePool(): Pool { return getPool(); }

export async function closeDatabase() {
  const existing = pool, temporaryWriter = rc98UatPool;
  pool = undefined;
  rc98UatPool = undefined;
  if (existing) await existing.end();
  if (temporaryWriter) await temporaryWriter.end();
}
