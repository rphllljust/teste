import { getPool } from '../../../../db/raw';
import { railwayIdentityBoundaryError } from '../../../../lib/api/railway-identity-boundary.mjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type CatalogReadiness = {
  orders_ready: boolean;
  receivables_ready: boolean;
  settlements_ready: boolean;
  periods_ready: boolean;
  documents_ready: boolean;
};

const response = (ready: boolean, code: string, checks: string[] = []): Response =>
  Response.json({ ready, code, checks }, {
    status: ready ? 200 : 503,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });

/**
 * Railway healthchecks must not use GET / as evidence of a working ERP.
 * One read-only catalog query checks the actual PostgreSQL dependency.
 * Never return connection strings, SQL exceptions, customer data or secrets.
 */
export async function GET(): Promise<Response> {
  const checks: string[] = [];
  if (!process.env.DATABASE_URL) checks.push('DATABASE_UNCONFIGURED');
  if (railwayIdentityBoundaryError()) checks.push('TRUSTED_IDENTITY_UNVERIFIED');
  if (checks.length) return response(false, 'NOT_READY', checks);

  try {
    const result = await getPool().query<CatalogReadiness>(`
      SELECT
        to_regclass('public.service_orders') IS NOT NULL AS orders_ready,
        to_regclass('public.receivables') IS NOT NULL AS receivables_ready,
        to_regclass('public.receivable_settlements') IS NOT NULL AS settlements_ready,
        to_regclass('public.finance_period_closes') IS NOT NULL AS periods_ready,
        to_regclass('public.nextcrm_order_document_links') IS NOT NULL AS documents_ready
    `);
    const state = result.rows[0];
    if (!state || Object.values(state).some(value => value !== true))
      return response(false, 'SCHEMA_NOT_READY');
    return response(true, 'READY');
  } catch {
    return response(false, 'DATABASE_UNAVAILABLE');
  }
}
