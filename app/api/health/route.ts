// Public liveness endpoint: deliberately does not query any database.
// Database readiness must be tested separately after the PostgreSQL adapter exists.
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json(
    { service: 'cisne', status: 'ok', check: 'liveness' },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
