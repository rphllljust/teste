import { Client } from 'pg';
import { checkErpDatabaseReadiness, classifyReadinessError } from '../../../../lib/runtime/readiness.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// No authentication data, schema details, connection strings, or migration names
// are exposed. Railway can use this endpoint as its explicit readiness probe.
let lastOperatorWarning = 0;
function warnReadiness(category: string) {
  const now = Date.now();
  if (now - lastOperatorWarning < 60000) return;
  lastOperatorWarning = now;
  // No SQL, user IDs, query results, hostnames, URLs, or secrets in logs.
  console.warn(JSON.stringify({ event: 'cisne.readiness.unavailable', category }));
}

export async function GET() {
  let ready = false;
  let client: Client | undefined;
  try {
    if (!process.env.DATABASE_URL) throw new Error('READINESS_DB_MISSING');
    // Do not reuse an idle pg.Pool socket between different Cloudflare Worker
    // request contexts. A stale connection can leave the request unresolved
    // and Wrangler returns a 500 outside the route's error handler.
    // Own and close this connection within the current request lifecycle.
    client = new Client({
      connectionString: process.env.DATABASE_URL,
      options: '-c default_transaction_read_only=on -c statement_timeout=3500',
      connectionTimeoutMillis: 4500,
      query_timeout: 4500,
    });
    await client.connect();
    ready = await checkErpDatabaseReadiness(
      (sql: string, params: readonly string[]) => client!.query(sql, [...params]),
      (reason: string) => warnReadiness(reason),
    );
  } catch (error) {
    warnReadiness(classifyReadinessError(error, process.env.DATABASE_URL));
    // Public response is always minimal; never leak DSN/schema/SQL details.
  } finally {
    if (client) {
      try { await client.end(); }
      catch (error) {
        ready = false;
        warnReadiness(classifyReadinessError(error, process.env.DATABASE_URL));
      }
    }
  }
  return Response.json(
    { status: ready ? 'ready' : 'unavailable' },
    { status: ready ? 200 : 503,
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
  );
}
