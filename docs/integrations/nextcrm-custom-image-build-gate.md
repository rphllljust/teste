# NextCRM bridge image build gate — CI only

The upstream NextCRM `ghcr.io/pdovhomilja/nextcrm-app:v0.41.0` image does NOT include the CISNE bridge overlay. Never deploy that official image and claim a working signed ERP integration.

The workflow `.github/workflows/nextcrm-bridge-image-build.yml`:
1. Checks out the pinned NextCRM gitlink.
2. Copies the reviewed HMAC protocol and private NextCRM route into the **working copy**, with the original upstream revision unchanged.
3. Builds the upstream `Dockerfile` into a temporary **local** image.
4. Checks the Next.js standalone runtime contains the compiled bridge endpoint.
5. Does not push or deploy, set Railway variables, run database migrations or preserve an image digest.

This is a **compilation gate, not an integration/UAT gate**. Later staging deployment must use the vetted custom image digest, distinct Railway environments, private HMAC secret and instance key, approved mapping rows and real NextCRM records. Review upstream Dockerfile and base-image version/digest before production; it currently uses the mutable `node:22-alpine` tag.

**NO-GO for staging deployment** until actual DNS, email/OTP account access, backups, MinIO public upload URL/TLS, secrets and obsolete staged bucket have been resolved and approved.

## Railway build directly from reviewed Git commit (no GHCR push needed)

The integration branch now contains `Dockerfile.nextcrm` in the repository root, derived byte-for-byte from the upstream `nextcrm-app:v0.41.0` Dockerfile with only three reviewed changes:
- Copy the NextCRM source from the pinned `integrations/nextcrm-upstream` submodule path.
- Copy the HMAC protocol and private route from the ERP's reviewed overlay.
- Copy the original `docker-entrypoint.sh` from the build stage to the runner.

`node scripts/verify-nextcrm-dockerfile-derivation.mjs` checks the gitlink SHA, exact Dockerfile source derivation and bridge presence. GitHub Actions compiles **the same root-context Dockerfile intended for Railway**, without uploading images or starting real services.

When the CI gate passes, the Railway `nextcrm-web` service may be configured **only as STAGED** with source `rphllljust/teste`, branch `integration/erp-postgres-nextcrm-candidate-20261115`, pinned commit SHA and `dockerfilePath=/Dockerfile.nextcrm`. The Railway Git checkout must include the submodule contents; if it does not, build must fail closed, never fall back to the upstream official image.

This gives a **source-pinned deployment**, not yet an immutable base-image digest: upstream `node:22-alpine` base image tags remain mutable. After an approved staging build, record the deployed Railway image digest and verify post-deployment. Production release should additionally pin base image digests and produce attestations/SBOM.

**NO-GO remains:** no CI build, however green, grants permission to apply the incomplete Railway patch or merge the production-tracked branch.

## End-to-end runtime check using the actual custom image

The custom image workflow now starts a **throwaway PostgreSQL 17 + pgvector**, isolated MinIO, the compiled NextCRM image and the Caddy gateway on a single local Docker network. It generates masked ephemeral secrets in GitHub Actions only.

The test verifies that:
- A signed request to the NextCRM bridge from within the isolated runtime reaches the real handler and is denied **with a valid signed 404** for an unknown user (real Prisma).
- A request carrying a forged HMAC is denied 401.
- The **same signed request** sent via the gateway is denied 404 **before reaching NextCRM**, with no NextCRM bridge response signature.
- Gateway local health returns HTTP 200 independently.
- All containers, volumes and the Docker network are deleted after the test.

This is closer to an actual deployment smoke than mocked tests, but still uses **synthetic data, ephemeral services and loopback ports only**. It does not deploy to Railway, publish a GHCR image, prove email/OTP login or migrate D1 records.
