# Authenticated Enterprise Gate — staging-only evidence

The GitHub Action workflow \`enterprise-staging-authenticated.yml\` is manually
opted into using PR #151's \`enterprise-auth-acceptance\` label. It requires the
staging GitHub environment secret \`CISNE_STAGING_PASSPHRASE\`, matching the
existing Railway staging login hash. No credential belongs in git or CI logs.
The workflow's checkout SHA, deployed Railway runtime SHA, and screenshot artifact
name must agree. PR labels and ordinary CI are not authorization to write business data.

\`CISNE_AUTHENTICATED_E2E=1\` selects **only** the \`staging-authenticated.spec.ts\`
file. This avoids accidental execution of mock-backed or development fixtures as
homologation. The suite uses real, authenticated requests, refuses 401/403/5xx
business APIs, and verifies 26 menu destinations in three viewports. It also
covers the separate MRP tab and persisted client and OS Object Page reads.

The tests do not seed or mutate staging; if the operator has no isolated client
and OS records, the gate fails closed. Integration tests with owner isolation and
cleanup prove transactions in disposable PostgreSQL, but **do not** prove that
the staging browser completed a write. The remaining embedded forms,
authorization matrix, NextCRM documents and MinIO file operations are not accepted.
A skipped or failed acceptance job is **NO-GO**, not success.
