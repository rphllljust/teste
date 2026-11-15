# NextCRM — optional AI boot and document fallback (Railway staging, 2026-11-15)

## Production incident isolated in staging (not a production rollout)

The actual `genuine-renewal/staging/nextcrm-web` deployment emitted
`Error: Missing credentials. Please pass an apiKey, or set OPENAI_API_KEY`
from compiled Next.js handlers even though the runtime was marked SUCCESS.
The NextCRM upstream (pinned to `d3bead9b44efe2cf94d0dfc2948af0f2c9270deb`)
creates `new OpenAI({ apiKey: process.env.OPENAI_API_KEY })` at **module
evaluation** in `inngest/lib/embedding-utils.ts` and
`inngest/functions/documents/enrich-document.ts`. Those modules are imported
during Inngest job registration, before users invoke any AI feature.

The key is optional for CRM sign-in, basic record management, and uploading
documents. **Do not inject a fake API key** to silence the error: it conceals
configuration defects and makes actual AI requests fail later.

## Isolated, pinned-source fix

The overlay files in `integrations/nextcrm-bridge-overlay/inngest/` preserve
upstream source and move OpenAI construction **inside function execution**.
They require a nonempty actual key only when an embedding or AI summary is
requested. The document ingestion job without a key still extracts supported
text and sets `processing_status=READY` with filename-only classification;
it explicitly returns `enriched: false`. It does not create a placeholder
embedding or call OpenAI.

`Dockerfile.nextcrm` copies both reviewed overlay files into the build
stage; `scripts/verify-nextcrm-dockerfile-derivation.mjs` enforces the exact
derivation from the pinned upstream Dockerfile. This does not alter the
gitlinked upstream, or update other files from NextCRM. It does not grant AI
entitlements, modify auth tables, create an endpoint, or deploy anything.

The GitHub `NextCRM custom bridge end-to-end image smoke` workflow boots an
ephemeral NextCRM with PostgreSQL/MinIO and no OPENAI_API_KEY, requests
`/en/sign-in` and `/api/inngest`, then fails if the historical OpenAI
constructor exception appears in container logs.

## Authentication is a separate UAT blocker

The same staging gateway records `GET /en/sign-in` HTTP 200, email OTP
send/verify endpoint HTTP 200 in some requests, and
`POST /api/auth/sign-in/social` HTTP 500; the NextCRM runtime reports
missing Google OAuth credentials. This patch does **not** enable Google
OAuth or prove browser sessions persist.

Before any deployment, confirm `BETTER_AUTH_URL`,
`NEXT_PUBLIC_APP_URL`, `APP_URL`, and the client-facing public gateway
URL are consistent and HTTPS, with secure cookies forwarded through Caddy.
Validate sign-in OTP using a browser with a dedicated test account, and
check `GET /api/auth/get-session` only with that account's session.
Do not log OTP codes, cookie values, tokens, or user identities. Do not
interpret `HTTP 200` from send-verification-otp as proof of email delivery.
If Google OAuth is desired later, configure verified Google client ID/secret
and callback domain and validate it separately.

## Acceptance

1. The exact candidate SHA passes full CI, including custom NextCRM image
   build, private HMAC bridge tests, and no-key handler smoke.
2. An immutable image digest is published from that exact SHA and verified.
3. Review/approve a **staging-only** image update, without a main/production
   merge or database migration outside the approved change.
4. In live Railway staging, verify no eager OpenAI error on unauthenticated
   sign-in, valid OTP auth session, normal CRM pages, document upload READY
   with no AI key, signed bridge isolation, and tenant ownership.
5. Keep production **NO-GO** until the original D1 data is reconciled with
   PostgreSQL, backup/restore and functional UAT are independently approved.

The Railway `production/teste` service follows `main` and can deploy
after merge; this isolated fix **must not be merged to main** during this work.
