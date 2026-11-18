import { databasePool } from '../../../../db/raw';
import { requestContext, respond, type RequestContext } from '../../../../lib/api/http';
import {
  evaluateNextcrmReadiness,
  isBridgeSecretConfigured,
} from '../../../../lib/integrations/nextcrm/readiness';

export const dynamic = 'force-dynamic';

type ReadinessRow = { name: string; present: boolean };
const REQUIRED_TABLES = [
  'nextcrm_erp_identity_mappings',
  'nextcrm_erp_client_account_mappings',
  'nextcrm_order_document_links',
  'nextcrm_order_document_events',
] as const;

async function readDatabaseReadiness() {
  const pool = databasePool();
  const tables = await pool.query<ReadinessRow>(
    `SELECT table_name AS name, true AS present
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [REQUIRED_TABLES],
  );
  const present = new Set(tables.rows.map((row) => row.name));
  const schemaApplied = REQUIRED_TABLES.every((name) => present.has(name));
  if (!schemaApplied) {
    return { schemaApplied, activeIdentityMappings: 0, activeAccountMappings: 0 };
  }

  const mappings = await pool.query<{ identities: string; accounts: string }>(
    `SELECT
       (SELECT COUNT(*) FROM nextcrm_erp_identity_mappings
        WHERE active = true AND verified_at IS NOT NULL)::text AS identities,
       (SELECT COUNT(*) FROM nextcrm_erp_client_account_mappings
        WHERE active = true AND verified_at IS NOT NULL)::text AS accounts`,
  );
  return {
    schemaApplied,
    activeIdentityMappings: Number(mappings.rows[0]?.identities ?? 0),
    activeAccountMappings: Number(mappings.rows[0]?.accounts ?? 0),
  };
}

export async function GET(request: Request) {
  let context: RequestContext | undefined;
  try {
    context = requestContext(request);
    const db = await readDatabaseReadiness();
    const result = evaluateNextcrmReadiness({
      environment: process.env.RAILWAY_ENVIRONMENT_NAME,
      publicUrl: process.env.CISNE_NEXTCRM_PUBLIC_URL,
      bridgeSecretConfigured: isBridgeSecretConfigured(process.env.CISNE_NEXTCRM_BRIDGE_SECRET),
      instanceKey: process.env.CISNE_NEXTCRM_INSTANCE_KEY,
      ...db,
    });
    return respond(result, context);
  } catch {
    return new Response(JSON.stringify({
      error: 'Não foi possível verificar a prontidão da integração NextCRM.',
      code: 'NEXTCRM_READINESS_UNAVAILABLE',
    }), {
      status: 503,
      headers: { 'Cache-Control': 'no-store, private', 'Content-Type': 'application/json' },
    });
  }
}
