# NextCRM OS ↔ Document authorization preflight

This module provides a **pure, fail-closed authorization preflight** only. No API endpoint,
database schema, file upload/download, NextCRM server-to-server client, or end-user
feature is enabled. It is intentionally safe to keep in a draft PR.

- `document-link-contract.ts` parses a strict bounded intent (no owner/tenant or file URL from client).
- `document-link-preflight.ts` requires a trusted actor identity, same-owner ERP OS,
  tenant-bound account mapping, and a NextCRM document specifically authorized for linking.
- A service implementation must independently enforce authenticated principal on each
  external query. Adapters are **not** implemented or accepted as trusted based on type alone.
- ERP legacy orders with `owner_id IS NULL` are denied for new document links,
  even if older read routes expose those rows.
- Document versions must match; a caller-provided digest must agree with upstream.
- No document file URL is returned. Binary download will need a separate authorization gate.
- Requests cannot supply their own `ownerId`, `tenantKey`, `publicUrl` or file path.
- The `oai-authenticated-user-id` header seen in ERP `requestContext` cannot be
  accepted directly from the Internet. The existing dispatch/ingress identity boundary
  must be verified in deployment before exposing write APIs.
- Do not deploy NextCRM before validating the independent Railway DB and its startup
  migrations and seed behavior.

**Not proof of end-to-end integration:** CI verifies only source and deterministic unit
tests; a real authorized document bridge needs private authentication, API contract,
persistent mapping store, idempotency, negative auth E2E and backup tests.
