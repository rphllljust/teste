import { databasePool } from '../../../../db/raw';
import { checkErpDatabaseReadiness } from '../../../../lib/runtime/readiness.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// No authentication data, schema details, connection strings, or migration names
// are exposed. Railway can use this endpoint as its explicit readiness probe.
export async function GET() {
  let ready = false;
  try {
    ready = await checkErpDatabaseReadiness((sql, params) => databasePool().query(sql, params));
  } catch {
    // Fail closed. Database errors may contain credentials and are not returned.
  }
  return Response.json(
    { status: ready ? 'ready' : 'unavailable' },
    { status: ready ? 200 : 503,
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
  );
}
