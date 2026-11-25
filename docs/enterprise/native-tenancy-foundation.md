# Tenant foundation — first enterprise slice

Migration `0017_enterprise_tenancy_foundation` adds **new** tenants, memberships, legal entities and audit tables. It does not rewrite or assign any current CRM, order, finance, accounting, inventory or fiscal record. The default actor-based ownership of legacy records remains in place until a separately approved expand/backfill/contract migration.

The native APIs are:
- `GET/POST /api/enterprise/tenants`: list only the actor's active memberships or create a tenant with its creator as the sole `owner`. Creation, membership and audit occur atomically.
- `GET/POST /api/enterprise/tenants/:id/legal-entities`: list tenant's companies only if the signed-in actor is a member; only `owner`/`admin` may create. An outside actor receives 404.
- Every mutation requires a UUID idempotency key and records a durable receipt. Authenticated identity comes from `requestContext`, never a client-supplied tenant header.

**This is not yet global multiempresa:** no delegated membership/role grants, RLS of all business tables, tenant association for legacy rows or cross-module financial authorization. Never claim those features or backfill silently.

Safe rollout: only additive tables, isolated PostgreSQL 16/18 migration+restore+handler checks, deploy to Railway staging; production remains frozen until current backup and restore are evidenced.