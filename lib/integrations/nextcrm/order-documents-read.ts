import type { Pool } from 'pg';

export type NextcrmOrderDocument = {
  id: string;
  kind: 'attachment' | 'contract' | 'photo' | 'service_report' | 'inspection' | 'invoice';
  version: number;
  sha256: string | null;
  linkedAt: string;
};

export type NextcrmOrderDocumentList = {
  orderFound: boolean;
  items: NextcrmOrderDocument[];
  hasMore: boolean;
};

/**
 * Read-only metadata for an ERP order. Every link must still have a currently
 * verified actor AND client/account mapping for the same instance and owner.
 * Revocation hides existing immutable links without modifying their audit log.
 * No NextCRM file, S3 URL, token, external identifier, or credential is returned.
 */
export async function listVisibleNextcrmOrderDocuments(
  db: Pick<Pool, 'query'>,
  serviceOrderId: string,
  trustedActorId: string,
): Promise<NextcrmOrderDocumentList> {
  const owned = await db.query(
    'SELECT id FROM service_orders WHERE id=$1 AND owner_id=$2 AND owner_id IS NOT NULL',
    [serviceOrderId, trustedActorId],
  );
  if (owned.rowCount !== 1) {
    return { orderFound: false, items: [], hasMore: false };
  }

  const rows = await db.query<{
    id: string;
    kind: NextcrmOrderDocument['kind'];
    version: number;
    sha256: string | null;
    linkedAt: Date;
  }>(`
    SELECT l.id,
      l.document_kind AS "kind",
      l.document_version AS "version",
      l.sha256,
      l.created_at AS "linkedAt"
    FROM nextcrm_order_document_links AS l
    JOIN service_orders AS so
      ON so.id=l.service_order_id AND so.owner_id=l.owner_id
      AND so.client_id=l.erp_client_id
    JOIN clients AS c
      ON c.id=l.erp_client_id AND c.owner_id=l.owner_id AND c.status='active'
    JOIN nextcrm_erp_identity_mappings AS im
      ON im.erp_actor_id=l.owner_id AND im.instance_key=l.tenant_key
      AND im.active=true AND im.verified_at IS NOT NULL
    JOIN nextcrm_erp_client_account_mappings AS am
      ON am.erp_client_id=l.erp_client_id AND am.erp_owner_id=l.owner_id
      AND am.instance_key=l.tenant_key
      AND am.nextcrm_account_id=l.nextcrm_account_id
      AND am.active=true AND am.verified_at IS NOT NULL
    WHERE l.service_order_id=$1 AND l.owner_id=$2
    ORDER BY l.created_at DESC,l.id DESC
    LIMIT 51
  `, [serviceOrderId, trustedActorId]);

  return {
    orderFound: true,
    items: rows.rows.slice(0, 50).map(row => ({
      id: row.id,
      kind: row.kind,
      version: row.version,
      sha256: row.sha256,
      linkedAt: row.linkedAt.toISOString(),
    })),
    hasMore: rows.rows.length > 50,
  };
}
