import type { OrderDocumentLinkDependencies, OwnedServiceOrder } from './document-link-preflight.ts';

/**
 * Narrow PostgreSQL adapter for ERP service-order ownership.
 * Database reads are parameterized, explicitly owner-scoped and have no writes.
 * Caller identity must come from a trusted server-side request context.
 * This alone does NOT authorize a document or implement an API.
 */
export interface OrderOwnershipQuery {
  query(
    statement: string,
    values: string[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SQL = `
SELECT so.id, so.owner_id, so.client_id
FROM service_orders AS so
INNER JOIN clients AS c
  ON c.id = so.client_id AND c.owner_id = so.owner_id AND c.status = 'active'
WHERE so.id = $1 AND so.owner_id = $2
LIMIT 1
`;

export function createPostgresOrderOwnershipReader(
  db: OrderOwnershipQuery,
): Pick<OrderDocumentLinkDependencies, 'findOwnedOrder'> {
  return {
    async findOwnedOrder(orderId: string, trustedActorId: string): Promise<OwnedServiceOrder | null> {
      if (!UUID.test(orderId) || !trustedActorId || trustedActorId.length > 200) return null;
      const result = await db.query(SQL, [orderId, trustedActorId]);
      const row = result.rows[0];
      if (!row || row.id !== orderId || row.owner_id !== trustedActorId ||
          typeof row.client_id !== 'string' || !UUID.test(row.client_id)) return null;
      return { id: orderId, ownerId: trustedActorId, clientId: row.client_id };
    },
  };
}
