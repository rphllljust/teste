import { databasePool } from '../../../../db/raw';
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
  try {
    ready = await checkErpDatabaseReadiness(
      (sql: string, params: readonly string[]) => databasePool().query(sql, [...params]),
      (reason: string) => warnReadiness(reason),
    );
  } catch (error) {
    warnReadiness(classifyReadinessError(error, process.env.DATABASE_URL));
    // Fail closed: exception messages and connection details are never returned.
  }
  return Response.json(
    { status: ready ? 'ready' : 'unavailable' },
    { status: ready ? 200 : 503,
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
  );
}
