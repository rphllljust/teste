# CISNE / Railway + PostgreSQL: staging safety gate

## Scope and observed baseline (2026-11-14)

- Railway project: `gallant-integrity` (`1f68621a-d07b-476b-87cc-26de71473a3c`).
- Only the `production` environment was observed; `staging` was not present.
- The existing `teste` service in `production` tracks `rphllljust/teste`/`main`.
- The latest observed Railway deployment was marked `SUCCESS`, but did not have a public domain.
- Runtime logs showed a Wrangler local server on `127.0.0.1:8787`. This is **not evidence** of a reachable, authenticated, PostgreSQL-backed ERP.
- The existing application imports `cloudflare:workers`, uses `env.DB`, SQLite-specific SQL, and a Sites-provided authentication header.

## Required isolation before any Railway provisioning

1. Create a fresh `staging` environment **inside this exact project** using Railway Dashboard > Project Settings > Environments, or an authenticated Railway CLI (`railway environment new staging` after verifying the selected project).
2. Resolve its actual environment ID and confirm `name === staging`.
3. Do not copy production services, variables or databases into staging automatically.
4. Always pass explicit project and staging environment IDs to provision or update commands.
5. Keep `production`, existing Sites deployments and Cloudflare D1 untouched.
6. Review possible service/database charges before provisioning.

## Target

Within staging only:

- `cisne-web`: Node.js-compatible application, binding to the Railway-provided `PORT` on a routable interface.
- `postgres-staging`: PostgreSQL with a private Railway network connection, no public TCP proxy unless specifically justified.
- `DATABASE_URL`: server-side variable reference to the Postgres service; never expose credentials to the browser, code, logs or CI output.
- Auth: trusted identity verified by the server; never accept `oai-authenticated-user-id` as a client-provided proof of identity.
- PostgreSQL Drizzle schema and migrations separate from legacy D1/SQLite migrations.

## Migration order / gates

1. **Node runtime gate**: production-style build/start on Node, HTTP liveness, shutdown behavior, documented port and readiness behavior.
2. **Authentication gate**: login/session and isolation tests; no client-supplied trusted identity headers.
3. **Persistence gate**: PostgreSQL migrations applied to disposable test data and real PostgreSQL integration tests.
4. **Functional gate**: customer -> contract -> OS -> events and applicable inventory/finance flows confirmed against PostgreSQL, including concurrency and idempotency.
5. **Data gate**: export, import, record-level reconciliation, backup/restore and cutover/rollback procedure validated. No irreversible production migration.
6. **Performance gate**: measured CPU/memory, pool saturation, slow queries, p50/p95/p99 and load tests appropriate to staging capacity.
7. **Release gate**: reviewed commit SHA, CI and smoke/E2E on the exact staging deployment; production change requires separate explicit approval.

## CI-proven Node preview (not a release)

The isolated `pnpm build:railway` / `pnpm start:railway` path has a GitHub Actions smoke that runs the Node server on a disposable CI port, checks `/api/health`, and confirms a spoofed Sites identity header is rejected with HTTP 503. The start script refuses execution unless `RAILWAY_PROJECT_ID` matches the approved project and `RAILWAY_ENVIRONMENT_NAME` is exactly `staging`. This does not demonstrate PostgreSQL migration, production availability, a public domain or a functioning login flow.

## Liveness is not readiness

`GET /api/health` is a public **liveness-only** endpoint. It intentionally does not query the database or authenticate a user and must not be used to conclude that PostgreSQL, authentication or the ERP business flows are operational.

Add a separate readiness check when the PostgreSQL adapter and authentication are implemented. Do not configure the Railway production service to use this route or deploy the current Wrangler-based application as the final runtime.

## Protected operations

- No automatic merge or production deployment.
- No deletion, mutation or deprecation of D1 data.
- No creation of Railway resources in `production`.
- No production traffic cutover.
- No claim of completion based solely on build success or Railway `SUCCESS` state.
