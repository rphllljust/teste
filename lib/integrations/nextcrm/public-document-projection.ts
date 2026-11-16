/**
 * Browser-safe projection of a verified ERP ↔ NextCRM document link.
 * The caller MUST revalidate the upstream document ACL before invoking it.
 * Keep opaque NextCRM document/account IDs and private auth/URL data server-side.
 */
export type VerifiedDocumentLink = {
  id: string;
  document_kind: string;
  document_version: number;
  created_at: string;
};

export type PublicDocumentLink = {
  id: string;
  kind: string;
  version: number;
  sha256: string | null;
  linkedAt: string;
};

export function publicNextcrmLinkedDocument(
  link: VerifiedDocumentLink,
  verifiedSha256: string | null,
): PublicDocumentLink {
  // Strict allowlist: never spread upstream database rows or verification objects.
  return {
    id: link.id,
    kind: link.document_kind,
    version: link.document_version,
    sha256: verifiedSha256,
    linkedAt: link.created_at,
  };
}
