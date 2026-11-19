import { databasePool } from '../../../../../db/raw';
import { failure, requestContext, respond, type RequestContext } from '../../../../../lib/api/http';
import {
  evaluateNextcrmReadiness,
  isBridgeSecretConfigured,
} from '../../../../../lib/integrations/nextcrm/readiness';
import { getNextcrmInstanceKey } from '../../../../../lib/integrations/nextcrm/config';

export const dynamic = 'force-dynamic';

type ReadinessRow = { name: string; present: boolean };
const REQUIRED_TABLES = [
  'nextcrm_erp_identity_mappings',
  'nextcrm_erp_client_account_mappings',
  'nextcrm_order_document_links',
  'nextcrm_order_document_events',
] as const;

async function readDatabaseReadiness(actorId: string, instanceKey: string | undefined) {
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
        WHERE erp_actor_id=$1 AND instance_key=$2
          AND active=true AND verified_at IS NOT NULL)::text AS identities,
       (SELECT COUNT(*) FROM nextcrm_erp_client_account_mappings m
        JOIN clients c ON c.id=m.erp_client_id AND c.owner_id=m.erp_owner_id
        WHERE m.erp_owner_id=$1 AND m.instance_key=$2
          AND m.active=true AND m.verified_at IS NOT NULL
          AND c.status='active')::text AS accounts`,
    [actorId, instanceKey ?? ''],
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
    const db = await readDatabaseReadiness(context.actorId, getNextcrmInstanceKey());
    const result = evaluateNextcrmReadiness({
      environment: process.env.RAILWAY_ENVIRONMENT_NAME,
      publicUrl: process.env.CISNE_NEXTCRM_PUBLIC_URL,
      bridgeSecretConfigured: isBridgeSecretConfigured(process.env.CISNE_NEXTCRM_BRIDGE_SECRET),
      instanceKey: process.env.CISNE_NEXTCRM_INSTANCE_KEY,
      ...db,
    });
    return respond(result, context);
  } catch (error) {
    return failure(error, context);
  }
}
