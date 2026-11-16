# Railway production authentication and PostgreSQL readiness — 2026-11-16

## Confirmed findings

The `genuine-renewal/production/teste` Railway service deployed commit `4d8ea2bfa8523b2bbea2ab1904b77152401d0870` successfully, but its configured variable inventory does not include `DATABASE_URL`. Public API calls observed on 2026-11-16 returned 401. These facts do **not** prove that the database-backed ERP works in production.

The previous `requestContext` accepted a client-supplied `oai-authenticated-user-id` header whenever the environment was not staging/test, without a runtime-verified ingress identity. A public Railway URL cannot safely trust that header. This is a security boundary defect independent of the multi-owner legacy data issue #70.

## Changes in this branch

1. `resolveRequestActor` accepts *only* the already signed staging cookie or an in-process WeakMap identity from test runners outside Railway. It denies all unverified identity headers in Railway production, preview and custom environments, and on generic public hosting.
2. `GET /api/health/ready` issues read-only PostgreSQL queries for seven required migration ledger IDs and ten essential ERP/Finance/NextCRM tables; returns 200 `{"status":"ready"}` or 503 `{"status":"unavailable"}`. No secrets, actor IDs, DB URLs, table names or SQL errors are exposed to the client.
3. Unit and PostgreSQL handler tests verify identity spoofing refusal, actual schema readiness, missing migrations, missing tables, and failures. These tests are wired into existing CI.

## Release gates / explicit exclusions

- **NO production deployment** from this branch until the correct isolated PostgreSQL database and verified production identity provider are commissioned.
- Do not "fix" 401 by trusting user-controlled HTTP headers or running as an anonymous superuser. The frontend can render for inspection; protected business operations remain inaccessible without a verified identity.
- Do not copy the staging synthetic operator cookie into production. No production login, OIDC, SSO, RBAC, migration, Railway variable, or volume change is attempted here.
- A future authenticated production release must integrate a verifiable identity provider (OIDC or mutually authenticated signed ingress), retain strict owner authorization, and independently resolve ownerless legacy records (#70, PR #73).
- After configuring DB connectivity in an isolated release candidate, verify the full migration ledger, backup+restore, `/api/health/ready` returning 200, negative unauthorized requests, real business handlers and desktop/mobile UAT at the **same deployed SHA**. Only then consider switching Railway healthcheck from `/` to `/api/health/ready`.
- Beware that the UAT service `cisne-rc75-uat-integrated` currently runs `b485bae7` while PR #76 CI passed at `db195901` (seven commits later); deploy parity is unproven. This branch does not alter either one.
