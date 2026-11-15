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
