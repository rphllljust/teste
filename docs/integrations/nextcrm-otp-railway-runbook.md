# NextCRM on Railway: OTP acceptance and session validation

## Real observation (2026-11-15)

The public `nextcrm-gateway-staging.up.railway.app` served login HTML
successfully, and some Resend-backed `POST /api/auth/email-otp/send-verification-otp`
requests returned HTTP 200. That status **does not prove email delivery**.
The pinned upstream `lib/auth.ts` did not inspect Resend SDK's
`{ data, error }` result. A provider validation error could be treated as
success, leading the UI to claim an OTP was sent.

The original login component also redirected to `/` immediately after
`signIn.emailOtp()`, without confirming the session cookie was accepted.
The gateway later observed root redirects even after an OTP request returned
HTTP 200, though no specific browser/session failure has been conclusively
proven.

## Stacked candidate fix, without touching Railway

This branch overlays only three pinned-upstream files:
- `lib/auth.ts`: validates successful provider acceptance after send and
  throws a **generic error** for failure or missing message ID. Production
  will no longer report a false "code sent" on rejected API responses.
- `lib/auth/otp-delivery.ts`: small pure helper, tested with synthetic
  accepted/error/no-ID responses; no live provider calls.
- `app/[locale]/(auth)/sign-in/components/LoginComponent.tsx`: after an
  accepted OTP, checks `authClient.getSession()` before redirecting. If
  there is no browser session, it reports the problem instead of silently
  returning to the login page.

No OTP, email address, key, browser cookie or session identifier is logged
by the new paths. The existing testUtils fallback for non-production
remains explicitly separated from production behavior.

The overlay is copied into `Dockerfile.nextcrm` without modifying the
upstream gitlink. CI checks exact Dockerfile derivation from upstream and
runs synthetic Resend result tests plus the ephemeral image smoke.
No Google OAuth client ID or secret is invented. Google sign-in remains
separately unconfigured and will still require legitimate credentials.

## Release requirements

1. Both stacked PRs pass their exact HEAD CI. Do not merge to `main`.
2. Confirm the sender `EMAIL_FROM` domain is verified in Resend, or use
   an explicitly authorized test account in the provider's permitted mode.
   Confirm the `RESEND_API_KEY` is correctly scoped and rotated if exposed.
3. Configure `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL` and `APP_URL`
   coherently for the HTTPS public gateway host (not private container DNS).
4. Test delivery and OTP session persistence with a designated, consenting
   account. A request accepted by Resend is not yet proof of inbox delivery.
5. Independently verify role activation, gateway session forwarding and
   callback cookies before declaring Railway staging ready.

NO production rollout. Stage only after immutable-image review and explicit
authorization. D1 historical records, backups and UAT remain separate gates.
