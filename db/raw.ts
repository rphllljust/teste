import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { normalizeSql } from './raw-sql.mjs';

type BoundStatement = { sql: string; params: unknown[] };
type SqlRowsResult<T = Record<string, unknown>> = { results: T[]; success: true; meta: { changes: number } };
let pool: Pool | undefined;

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.PGPOOL_MAX ?? 10), connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, maxUses: 10000 });
  return pool;
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

export async function closeDatabase() { if (pool) await pool.end(); pool = undefined; }
