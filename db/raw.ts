import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

type BoundStatement = { sql: string; params: unknown[] };
type D1Result<T = Record<string, unknown>> = { results: T[]; success: true; meta: { changes: number } };
let pool: Pool | undefined;

function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.PGPOOL_MAX ?? 10), connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, maxUses: 10000 });
  return pool;
}

function normalizeSql(sql: string, previousChanges?: number): string {
  let out = sql.replace(/\bchanges\(\)\s*=\s*1\b/gi, previousChanges === 1 ? 'TRUE' : 'FALSE');
  out = out.replace(/\binstr\(lower\(([^,]+)\),\s*lower\((\?|\$\d+)\)\)\s*>\s*0/gi, 'POSITION(LOWER($2) IN LOWER($1)) > 0');
  let index = 0;
  return out.replace(/\?/g, () => `$${++index}`);
}

class Statement {
  constructor(private readonly sql: string) {}
  bind(...params: unknown[]) {
    const bound: BoundStatement = { sql: this.sql, params };
    return {
      first: async <T extends QueryResultRow = Record<string, unknown>>(): Promise<T | null> => { const result = await getPool().query<T>(normalizeSql(bound.sql), bound.params); return result.rows[0] ?? null; },
      all: async <T extends QueryResultRow = Record<string, unknown>>(): Promise<D1Result<T>> => { const result = await getPool().query<T>(normalizeSql(bound.sql), bound.params); return { results: result.rows, success: true, meta: { changes: result.rowCount ?? 0 } }; },
      run: async (): Promise<{ success: true; meta: { changes: number } }> => { const result = await getPool().query(normalizeSql(bound.sql), bound.params); return { success: true, meta: { changes: result.rowCount ?? 0 } }; },
      _bound: bound,
    };
  }
}

function clientStatement(client: PoolClient, statement: BoundStatement, previousChanges: number) { return client.query(normalizeSql(statement.sql, previousChanges), statement.params); }

export function database() {
  return {
    prepare(sql: string) { return new Statement(sql); },
    async batch(statements: Array<{ _bound?: BoundStatement }>) {
      const client = await getPool().connect();
      const results: Array<D1Result> = [];
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
  };
}

export async function closeDatabase() { if (pool) await pool.end(); pool = undefined; }
