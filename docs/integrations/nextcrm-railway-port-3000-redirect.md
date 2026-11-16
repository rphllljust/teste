# Railway staging / NextCRM — browser redirect leaked port :3000

## Observation and scope
The operator reports that visiting the public gateway redirects the browser to
`nextcrm-gateway-staging.up.railway.app:3000/en` and Chrome times out.
The gateway's public Railway HTTPS domain has **no port suffix**; NextCRM
itself uses TCP 3000 only inside `nextcrm-web.railway.internal`.

A separate external probe did load the full
`https://nextcrm-gateway-staging.up.railway.app/en/sign-in` page. That proves
public ingress reachability, not that the root / locale redirects are healthy.
The Railway OAuth connection redacts existing variable values, so this review
cannot assert what public URLs were set previously.

## Defense-in-depth patch
1. The Caddy public gateway reasserts the true HTTPS public origin for Next.js
   via `X-Forwarded-Proto=https`, `X-Forwarded-Port=443`, and the public host.
   This is specifically for the Railway-managed TLS-terminating public gateway,
   not for a public port 3000 or a private-only NextCRM service.
2. Upstream `Location` redirects containing the exact **known public
   hostname** with internal `:3000`, or an `http` scheme, are normalized to
   the public `https://...up.railway.app` origin. Redirects to external OAuth
   providers must stay unchanged.
3. The NextCRM browser auth client uses `window.location.origin` to call
   Better Auth on the exact host that served the UI instead of a Next.js
   build-time embedded URL (which may be stale or internal).
4. The staged predeploy gate now requires `BETTER_AUTH_URL`, `APP_URL`,
   and `NEXT_PUBLIC_APP_URL` all equal
   `https://nextcrm-gateway-staging.up.railway.app`, with no `:3000`.
5. Ephemeral gateway tests emulate a misconfigured upstream `Location`
   response, verify normalized HTTPS redirect, preserve external OAuth,
   and assert the upstream receives HTTPS/443 and the public host. The existing
   internal HMAC endpoint block remains required.

## Review gate — NO-GO for live deployment until verified
- Confirm the exact SHA passes all CI, including gateway response-header tests
  and custom NextCRM immutable image build.
- The gateway tracked Railway source currently follows
  `integration/erp-postgres-nextcrm-candidate-20261115` and will **not**
  change from this draft PR alone.
- The app's public URL variables can be staged without deploying; review
  `get-staged-changes` to ensure only expected values are changed.
  When tested, a staged set of the three canonical URL variables reported no
  staged diff — current plaintext values are not visible via OAuth.
- Only after release/image review and explicit staged-deployment approval,
  update gateway from a safe pinned commit and NextCRM image by immutable
  digest. Avoid touching `main` or production.
- Check browser HTTP redirects through root, `/en`, `/sign-in`, and login
  session cookie with authorized UAT user. Do not claim session success from
  a green healthcheck or an accepted OTP request.

Keep the original D1 data reconciliation, backup/restore of persistent DBs,
and full functional acceptance as independent NO-GO gates.
