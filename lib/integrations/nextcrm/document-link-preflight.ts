import {
  validateNextcrmOrderDocumentLinkInput,
  type NextcrmOrderDocumentLinkInput,
} from './document-link-contract.ts';

/**
 * Fail-closed authorization boundary; contains no database access or network
 * calls. Concrete adapters MUST enforce authorization on their own server.
 * Does NOT grant permission to use a document or authorize file download.
 */
export class OrderDocumentLinkDenied extends Error {
  readonly code = 'ORDER_DOCUMENT_LINK_DENIED';
  constructor() { super('Vínculo documental não autorizado.'); }
}

export interface MappedIdentity {
  erpActorId: string;
  nextcrmSubjectId: string;
  tenantKey: string;
}
export interface OwnedServiceOrder {
  id: string;
  ownerId: string | null;
  clientId: string | null;
}
export interface MappedAccount {
  accountId: string;
  tenantKey: string;
}
export interface AuthorizedDocumentEvidence {
  id: string;
  tenantKey: string;
  accountId: string | null;
  version: number;
  sha256: string | null;
  canLink: boolean;
}
export interface OrderDocumentLinkDependencies {
  /** Map only a server-validated ERP principal to a NextCRM identity. */
  resolveMappedIdentity(erpActorId: string): Promise<MappedIdentity | null>;
  /** Read order using authenticated principal, ideally owner_id = ? AND id = ?. */
  findOwnedOrder(orderId: string, erpActorId: string): Promise<OwnedServiceOrder | null>;
  /** Only return an explicitly authorized account mapping in this tenant. */
  findAccountMapping(erpClientId: string, tenantKey: string): Promise<MappedAccount | null>;
  /** Must validate permissions on NextCRM server for the mapped subject. */
  verifyDocumentForLink(documentId: string, subjectId: string, accountId: string, erpClientId: string, tenantKey: string): Promise<AuthorizedDocumentEvidence | null>;
}

export interface AuthorizedOrderDocumentLink extends NextcrmOrderDocumentLinkInput {
  /** Computed entirely from trusted back-end identity mapping. */
  tenantKey: string;
  ownerId: string;
  erpClientId: string;
  nextcrmAccountId: string;
}

/**
 * Refuses cross-tenant, cross-account, orphaned, stale, or unauthorized links.
 * Never trust ownerId, tenantKey, external file URLs or auth claims in payload.
 * No persistence: API, D1 schema and NextCRM transport remain separate gates.
 */
export async function authorizeOrderDocumentLink(
  payload: unknown,
  trustedErpActorId: string,
  dependencies: OrderDocumentLinkDependencies,
): Promise<AuthorizedOrderDocumentLink> {
  if (!trustedErpActorId || trustedErpActorId.length > 200) throw new OrderDocumentLinkDenied();
  const input = validateNextcrmOrderDocumentLinkInput(payload);
  const identity = await dependencies.resolveMappedIdentity(trustedErpActorId);
  if (!identity || identity.erpActorId !== trustedErpActorId ||
      !identity.nextcrmSubjectId || !identity.tenantKey) throw new OrderDocumentLinkDenied();

  const order = await dependencies.findOwnedOrder(input.serviceOrderId, trustedErpActorId);
  // Legacy ownerless orders are never valid for document sharing.
  if (!order || order.id !== input.serviceOrderId ||
      order.ownerId !== trustedErpActorId || !order.clientId) throw new OrderDocumentLinkDenied();

  const account = await dependencies.findAccountMapping(order.clientId, identity.tenantKey);
  if (!account || !account.accountId || account.tenantKey !== identity.tenantKey) {
    throw new OrderDocumentLinkDenied();
  }

  const document = await dependencies.verifyDocumentForLink(input.nextcrmDocumentId, identity.nextcrmSubjectId, account.accountId, order.clientId, identity.tenantKey);
  if (!document || !document.canLink || document.id !== input.nextcrmDocumentId ||
      document.tenantKey !== identity.tenantKey || document.accountId !== account.accountId ||
      document.version !== input.version) throw new OrderDocumentLinkDenied();

  // Client-provided digest may only corroborate the trusted upstream metadata.
  if (input.sha256 && input.sha256 !== document.sha256) throw new OrderDocumentLinkDenied();

  return {
    ...input,
    sha256: document.sha256 ?? undefined,
    tenantKey: identity.tenantKey,
    ownerId: trustedErpActorId,
    erpClientId: order.clientId,
    nextcrmAccountId: account.accountId,
  };
}
