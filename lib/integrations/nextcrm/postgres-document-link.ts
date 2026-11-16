import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  authorizeOrderDocumentLink,
  OrderDocumentLinkDenied,
  type OrderDocumentLinkDependencies,
  type AuthorizedOrderDocumentLink,
} from './document-link-preflight.ts';

/**
 * One-way ERP metadata link. No document content, secrets, S3 URLs or NextCRM
 * credentials are saved. External authorization must be checked BEFORE this
 * transaction. This module is not exposed as an HTTP route.
 */
export class OrderDocumentLinkConflict extends Error {
  readonly code = 'ORDER_DOCUMENT_LINK_CONFLICT';
  constructor() { super('O vínculo documental já existe com informações diferentes.'); }
}

export interface PersistDocumentLinkRequest {
  payload: unknown;
  trustedErpActorId: string;
  idempotencyKey: string;
  correlationId: string;
  dependencies: OrderDocumentLinkDependencies;
  db: Pick<Pool, 'connect'>;
}

export interface StoredDocumentLinkResult {
  id: string;
  created: boolean;
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const CORRELATION = /^[a-zA-Z0-9_-]{8,64}$/;

function hashLink(link: AuthorizedOrderDocumentLink): string {
  return createHash('sha256').update(JSON.stringify({
    serviceOrderId: link.serviceOrderId,
    ownerId: link.ownerId,
    erpClientId: link.erpClientId,
    tenantKey: link.tenantKey,
    nextcrmAccountId: link.nextcrmAccountId,
    nextcrmSubjectId: link.nextcrmSubjectId,
    nextcrmDocumentId: link.nextcrmDocumentId,
    documentKind: link.documentKind,
    version: link.version,
    sha256: link.sha256 ?? null,
  })).digest('hex');
}

export async function authorizeAndPersistOrderDocumentLink(
  request: PersistDocumentLinkRequest,
): Promise<StoredDocumentLinkResult> {
  const { trustedErpActorId: actor, idempotencyKey, correlationId, db } = request;
  if (!actor || actor.length > 200 || !UUID.test(idempotencyKey) ||
      !CORRELATION.test(correlationId)) throw new OrderDocumentLinkDenied();

  // Fail closed: this is an upstream NextCRM authorization boundary, NOT a
  // claim from an HTTP payload. Concrete dependencies must be independently
  // protected by server-side authentication and tenant checks.
  const authorized = await authorizeOrderDocumentLink(
    request.payload, actor, request.dependencies,
  );
  if (authorized.ownerId !== actor || !UUID.test(authorized.serviceOrderId) ||
      !UUID.test(authorized.erpClientId) || !authorized.tenantKey ||
      !authorized.nextcrmAccountId || !UUID.test(authorized.nextcrmSubjectId))
    throw new OrderDocumentLinkDenied();

  const hash = hashLink(authorized);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Recheck the order and active client *inside the write transaction*.
    // Lock the same rows to prevent an owner/client-status race during insert.
    const owned = await client.query(`
      SELECT so.id
      FROM service_orders AS so
      JOIN clients AS c
        ON c.id = so.client_id AND c.owner_id = so.owner_id
      WHERE so.id = $1 AND so.owner_id = $2
        AND so.client_id = $3 AND c.status = 'active'
      FOR SHARE OF so, c
    `, [authorized.serviceOrderId, actor, authorized.erpClientId]);
    if (owned.rowCount !== 1) throw new OrderDocumentLinkDenied();

    // Close the local TOCTOU window: approvals can be deactivated while the
    // external NextCRM ACL check is running. Lock BOTH mappings at the exact
    // moment of persistence, and require the exact principal/account that
    // produced the signed external authorization.
    const currentMappings = await client.query(`
      SELECT 1
      FROM nextcrm_erp_identity_mappings AS identity
      JOIN nextcrm_erp_client_account_mappings AS account
        ON account.erp_owner_id = identity.erp_actor_id
      WHERE identity.erp_actor_id = $1
        AND account.erp_client_id = $2
        AND identity.nextcrm_subject_id = $3
        AND account.nextcrm_account_id = $4
        AND identity.instance_key = $5
        AND account.instance_key = $5
        AND identity.active = true AND account.active = true
        AND identity.verified_at IS NOT NULL
        AND account.verified_at IS NOT NULL
      FOR SHARE OF identity, account
    `, [actor, authorized.erpClientId, authorized.nextcrmSubjectId,
      authorized.nextcrmAccountId, authorized.tenantKey]);
    if (currentMappings.rowCount !== 1) throw new OrderDocumentLinkDenied();

    const existingSql = `
      SELECT id, idempotency_key, request_hash
      FROM nextcrm_order_document_links
      WHERE owner_id = $1
        AND (
          idempotency_key = $2
          OR (service_order_id = $3 AND nextcrm_document_id = $4 AND document_version = $5)
        )
      LIMIT 2
    `;
    const existingValues = [
      actor, idempotencyKey, authorized.serviceOrderId,
      authorized.nextcrmDocumentId, authorized.version,
    ];
    const existing = await client.query(existingSql, existingValues);
    if (existing.rows.length) {
      if (existing.rows.length !== 1 || existing.rows[0].idempotency_key !== idempotencyKey ||
          existing.rows[0].request_hash !== hash) throw new OrderDocumentLinkConflict();
      await client.query('COMMIT');
      return { id: existing.rows[0].id as string, created: false };
    }

    const linkId = randomUUID();
    const inserted = await client.query(`
      INSERT INTO nextcrm_order_document_links(
        id, service_order_id, owner_id, erp_client_id, tenant_key,
        nextcrm_account_id, nextcrm_document_id, document_kind,
        document_version, sha256, idempotency_key, request_hash,
        created_by, correlation_id
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [
      linkId, authorized.serviceOrderId, actor, authorized.erpClientId,
      authorized.tenantKey, authorized.nextcrmAccountId,
      authorized.nextcrmDocumentId, authorized.documentKind, authorized.version,
      authorized.sha256 ?? null, idempotencyKey, hash, actor, correlationId,
    ]);

    if (inserted.rowCount === 0) {
      // Concurrent identical idempotent retries converge to exactly one link.
      // Any reused key with changed payload or natural-key collision is denied.
      const retry = await client.query(existingSql, existingValues);
      if (retry.rows.length !== 1 || retry.rows[0].idempotency_key !== idempotencyKey ||
          retry.rows[0].request_hash !== hash) throw new OrderDocumentLinkConflict();
      await client.query('COMMIT');
      return { id: retry.rows[0].id as string, created: false };
    }
    if (inserted.rowCount !== 1) throw new OrderDocumentLinkConflict();

    await client.query(`
      INSERT INTO nextcrm_order_document_events(
        id, link_id, event_type, actor_id, request_hash, correlation_id
      ) VALUES($1,$2,'linked',$3,$4,$5)
    `, [randomUUID(), linkId, actor, hash, correlationId]);

    await client.query('COMMIT');
    return { id: linkId, created: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
