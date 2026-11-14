# ADR: CISNE modular monolith on Railway with PostgreSQL

**Status:** accepted as target architecture; **not** permission to migrate or deploy production  
**Scope:** `rphllljust/teste` and Railway project `1f68621a-d07b-476b-87cc-26de71473a3c`

## Current facts (verified 2026-11-14)

The application's production code imports `cloudflare:workers` directly and uses D1's synchronous binding through `db/raw.ts`. It builds with vinext plus the Cloudflare Vite plugin, and the existing `start` script runs a Wrangler local dev worker. App-layer authentication trusts a Sites-injected identity header.

Railway `production` currently contains a service named `teste` connected to `rphllljust/teste`/`main`. Its latest deployment reported `SUCCESS`, but logs revealed Wrangler on `127.0.0.1:8787`, and no public domain or Postgres service was configured. **Do not equate build/deploy success with an accessible or authenticated ERP.**

No `staging` environment exists yet. The available Railway API connector does not expose environment creation. **Never provision a database or connect new application source without an explicit staging environment ID.**

## Decision

Choose a **modular monolith** rather than premature microservices. Keep Next.js/React as the presentation + HTTP boundary; move business rules into application/domain modules; use PostgreSQL as the central transactional store on Railway. Keep current Cloudflare D1 and Sites unchanged during incremental migration.

Initial boundaries: identity, customers, commercial, contracts, field-service, scheduling, inventory, procurement, MRP, billing, finance, treasury and accounting. Each entity has one owning domain. Cross-domain operations use typed application contracts and transactions, not duplicate master records.

A separate `vite.railway.config.ts` tests standalone Node output, without using the Cloudflare Vite plugin. Legacy D1 bindings are **deliberately unavailable** on this target. This does not make the ERP fully operational: independent authentication, actual PostgreSQL repositories, tested migrations and data reconciliation are still required.

## Security decisions

- Never trust `oai-authenticated-user-id` from Railway HTTP traffic.
- Until sessions are independently verified, all legacy APIs using that Sites header reject Railway requests.
- A public liveness response is not proof of database readiness or user authorization.
- Use a private Railway Postgres connection; do not return credentials to clients or logs.
- Preserve stable owner IDs through identity migration. Verify tenant isolation at the repository boundary and by API tests.

## PostgreSQL migration plan

1. Build a PostgreSQL Drizzle schema in a separate migrations directory. Preserve business IDs, monetary integer scales and quantity units; avoid floats.
2. Port one complete customer → contract → OS → event vertical slice, with integration tests against PostgreSQL.
3. Port execution, procurement, inventory/MRP, billing, treasury and accounting in dependency order.
4. Export D1 into versioned and validated datasets, load an isolated PostgreSQL staging database and reconcile row counts, keys, balances and accounting events.
5. Test concurrency, idempotency, authentication, failover, backup/restore and representative E2E traffic.
6. Plan a write-freeze or proven synchronization protocol for cutover. No implicit dual-write and no unilateral production migration.

## Release controls

- Scope every Railway change to the verified project and staging environment ID.
- Never merge a PR solely because CI was green; compare Git SHA, migrations and post-deploy E2E.
- Do not configure any public Railway domain for the application before real sessions, PostgreSQL and authorization have passed staging tests.
- Keep the existing `teste` service and Cloudflare production unchanged unless separately authorized.
- Log response p50/p95/p99, process restarts, memory, CPU, pool utilization, lock waits and slow queries to diagnose historical Railway stalls.
- All future production deployment requires explicit approval, verified backup/restore and a tested rollback procedure.
