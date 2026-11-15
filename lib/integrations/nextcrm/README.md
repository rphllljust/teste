# NextCRM OS ↔ Document authorization preflight

This module now includes the **fail-closed authorization preflight**, a PostgreSQL
ownership reader, and an **internal transactional document-link persistence adapter**.
There is still no public API endpoint, real NextCRM server-to-server verifier, file
upload/download in the ERP, or end-user UI. Everything remains isolated in a draft PR.

- `document-link-contract.ts` parses a strict bounded intent (no owner/tenant or file URL from client).
- `document-link-preflight.ts` requires a trusted actor identity, same-owner ERP OS,
  tenant-bound account mapping, and a NextCRM document specifically authorized for linking.
- A service implementation must independently enforce authenticated principal on each
  external query. Adapters are **not** implemented or accepted as trusted based on type alone.
- ERP legacy orders with `owner_id IS NULL` are denied for new document links,
  even if older read routes expose those rows.
- Document versions must match; a caller-provided digest must agree with upstream.
- No document file URL is returned. Binary download needs a separate authorization gate.
- PostgreSQL migration 0001 adds immutable metadata links and one auditable `linked` event per
  newly created link. The transaction rechecks OS ownership and active client under a row lock,
  with a stable request hash and unique idempotency key. Retry is safe, mismatched replay fails.
- The persistence adapter only accepts a full preflight result from trusted dependencies;
  no caller may construct tenant/owner values from a public payload.
- Requests cannot supply their own `ownerId`, `tenantKey`, `publicUrl` or file path.
- The `oai-authenticated-user-id` header seen in ERP `requestContext` cannot be
  accepted directly from the Internet. The existing dispatch/ingress identity boundary
  must be verified in deployment before exposing write APIs.
- Do not deploy NextCRM before validating the independent Railway DB and its startup
  migrations and seed behavior.

**Not proof of end-to-end integration:** CI verifies only source and deterministic unit
tests; a real authorized document bridge needs private authentication, API contract,
persistent mapping store, idempotency, negative auth E2E and backup tests.
