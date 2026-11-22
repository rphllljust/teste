# Enterprise authenticated staging gate — SHA-bound, real data

The authorized deployed candidate for the **staging-only** authenticated audit is
`feat/cisne-shell-fiori-redwood-20261122` in `rphllljust/teste`.
The workflow `.github/workflows/enterprise-staging-authenticated.yml` is opt-in:
a push **on that exact authorized branch** with `[enterprise-auth]` in its
head commit message runs the protected staging job. A `workflow_dispatch`
invocation, when registered and available in GitHub Actions, is also subject
to the same branch, HEAD, deploy identity and secret checks. Merely opening
a PR, adding a label or obtaining ordinary CI success does not authorize it.

The job checks out the exact SHA and fails closed unless all of these agree:
- the authorized GitHub branch ref and its current HEAD;
- the checkout SHA and requested candidate SHA;
- `https://cisne-web-staging-staging.up.railway.app/api/release/identity`
  reporting `environment=staging` and the identical deployed SHA;
- the protected GitHub `staging` environment secret
  `CISNE_STAGING_PASSPHRASE` being present and having the required length.

Do not put the staging password, derived hashes or business data in git,
workflow logs, screenshots or publicly accessible artifacts. The workflow
uses `CISNE_AUTHENTICATED_E2E=1` to select **only**
`test/e2e/staging-authenticated.spec.ts`. That suite performs real browser
session checks without API mocks, rejects unauthorized/failed business APIs,
and covers the 26 navigation destinations at desktop, tablet and mobile
widths, plus persisted client and service-order reads where fixtures exist.

The gate remains **NO-GO** when the runtime SHA differs from the candidate,
the protected secret is unavailable, any required business fixture is
missing, any test fails or the suite is not executed. Synthetic or
unauthenticated tests cannot be substituted for this acceptance.
The workflow only uploads a short-lived source inventory on success,
never screenshots or browser traces containing personal data.

Staging browser acceptance does not on its own authorize a production
deployment or prove every ERP business transaction end-to-end. Production
promotion requires the separate release controls and business approval.
