import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const upstreamSha='d3bead9b44efe2cf94d0dfc2948af0f2c9270deb';
const upstreamRev=execFileSync('git',['-C','integrations/nextcrm-upstream','rev-parse','HEAD'],{encoding:'utf8'}).trim();
const gitlink=execFileSync('git',['ls-tree','HEAD','integrations/nextcrm-upstream'],{encoding:'utf8'}).trim().split(/\s+/)[2];
if(upstreamRev!==upstreamSha||gitlink!==upstreamSha)throw new Error('NO-GO: NextCRM upstream SHA mismatch');
const upstream=await readFile('integrations/nextcrm-upstream/Dockerfile','utf8');
const target=await readFile('Dockerfile.nextcrm','utf8');
const upstreamMinio=await readFile('integrations/nextcrm-upstream/lib/minio.ts','utf8');
const reviewedMinio=await readFile('integrations/nextcrm-bridge-overlay/lib/minio.ts','utf8');
const oldRegionLine="    region: \"us-east-1\", // MinIO requires a region value; actual value doesn't matter";
const replacementRegionLine="    // Native Railway Bucket requires the SigV4 scope region auto.\n    // Legacy MinIO remains us-east-1 without any runtime behavior change.\n    region: process.env.CISNE_RC84_RAILWAY_BUCKET_MODE === \"true\" ? \"auto\" : \"us-east-1\",";
const oldMinioLine='    forcePathStyle: true, // REQUIRED for MinIO — without this, SDK uses virtual-hosted-style which breaks';
const replacementMinioLine=[
  '    // Standard MinIO remains path-style. The explicit RC84 Railway Bucket mode',
  '    // uses canonical S3 virtual hosts; never enable this for legacy services.',
  "    forcePathStyle: process.env.CISNE_RC84_RAILWAY_BUCKET_MODE !== 'true',",
].join('\n');
if(upstreamMinio.split(oldMinioLine).length!==2 ||
   reviewedMinio!==upstreamMinio.replace(oldMinioLine,replacementMinioLine).replace(oldRegionLine,replacementRegionLine))
  throw new Error('NO-GO: storage SDK overlay differs from a single approved vhost setting');

const banner="# CISNE NextCRM stage image: generated from upstream Dockerfile at gitlink\n# d3bead9b44efe2cf94d0dfc2948af0f2c9270deb, plus reviewed private bridge.\n# CI verifies byte-level derivation. Source must include initialized submodules.\n# Build with: docker build -f Dockerfile.nextcrm -t nextcrm-candidate .\n";
// Pin the isolated seed/S3 overlay to only the two intentional edits.
const upstreamEntry=await readFile('integrations/nextcrm-upstream/docker-entrypoint.sh','utf8');
const isolatedEntry=await readFile('integrations/nextcrm-bridge-overlay/docker-entrypoint.sh','utf8');
const oldBucketCondition="if [ -n \"$MINIO_ENDPOINT\" ] && [ -n \"$MINIO_ACCESS_KEY\" ] && [ -n \"$MINIO_SECRET_KEY\" ] && [ -n \"$MINIO_BUCKET\" ]; then";
const newBucketCondition="if [ \"${CISNE_RC84_RAILWAY_BUCKET_MODE:-}\" = \"true\" ]; then\n  echo \"==> RC85 isolated Railway S3: bucket already provisioned. Never create bucket or update public policy.\"\nelif [ -n \"$MINIO_ENDPOINT\" ] && [ -n \"$MINIO_ACCESS_KEY\" ] && [ -n \"$MINIO_SECRET_KEY\" ] && [ -n \"$MINIO_BUCKET\" ]; then";
const oldSeedCondition="if [ \"$USER_COUNT\" = \"0\" ] || [ -z \"$USER_COUNT\" ]; then";
const newSeedCondition="if [ \"${CISNE_RC84_RAILWAY_BUCKET_MODE:-}\" = \"true\" ]; then\n  echo \"==> RC85 isolated staging: skip demo seed and any automatic user creation.\"\nelif [ \"$USER_COUNT\" = \"0\" ] || [ -z \"$USER_COUNT\" ]; then";
if(upstreamEntry.split(oldBucketCondition).length!==2 ||
   upstreamEntry.split(oldSeedCondition).length!==2 ||
   isolatedEntry!==upstreamEntry.replace(oldBucketCondition,newBucketCondition)
     .replace(oldSeedCondition,newSeedCondition))
  throw Error('NO-GO: isolated entrypoint differs from reviewed two-guard overlay');
execFileSync('sh',['-n','integrations/nextcrm-bridge-overlay/docker-entrypoint.sh']);

const substitutions=[
  [
    "COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./",
    "COPY integrations/nextcrm-upstream/pnpm-lock.yaml integrations/nextcrm-upstream/pnpm-workspace.yaml integrations/nextcrm-upstream/package.json ./"
  ],
  [
    "COPY . .",
    "COPY integrations/nextcrm-upstream/ .\n# Install the reviewed ERP bridge on top of the pinned upstream worktree.\nCOPY lib/integrations/nextcrm/bridge-protocol.ts ./lib/erp-bridge/bridge-protocol.ts\nCOPY integrations/nextcrm-bridge-overlay/app/api/internal/erp-document-authorization/route.ts ./app/api/internal/erp-document-authorization/route.ts\n# Optional Railway Bucket vhost signing, legacy MinIO remains unchanged.\nCOPY integrations/nextcrm-bridge-overlay/lib/minio.ts ./lib/minio.ts\n# Optional AI must not block NextCRM startup or document ingestion.\nCOPY integrations/nextcrm-bridge-overlay/inngest/lib/embedding-utils.ts ./inngest/lib/embedding-utils.ts\nCOPY integrations/nextcrm-bridge-overlay/inngest/functions/documents/enrich-document.ts ./inngest/functions/documents/enrich-document.ts\n# Safely report OTP delivery failures and confirm browser session before redirect.\nCOPY integrations/nextcrm-bridge-overlay/lib/auth.ts ./lib/auth.ts\nCOPY integrations/nextcrm-bridge-overlay/lib/auth/otp-delivery.ts ./lib/auth/otp-delivery.ts\nCOPY integrations/nextcrm-bridge-overlay/lib/auth-client.ts ./lib/auth-client.ts\nCOPY integrations/nextcrm-bridge-overlay/staging-login/LoginComponent.tsx ./app/[locale]/(auth)/sign-in/components/LoginComponent.tsx"
  ],
  [
    "COPY --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh",
    "COPY --chown=nextjs:nodejs integrations/nextcrm-bridge-overlay/docker-entrypoint.sh ./docker-entrypoint.sh\nCOPY --chown=nextjs:nodejs scripts/nextcrm-staging-preflight.mjs ./nextcrm-staging-preflight.mjs"
  ],
  [
    "FROM node:22-alpine AS deps",
    "FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS deps"
  ],
  [
    "FROM node:22-alpine AS build",
    "FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS build"
  ],
  [
    "FROM node:22-alpine AS runner",
    "FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS runner"
  ]
];
let expected=upstream;
for(const [a,b] of substitutions){
  if(expected.split(a).length!==2)throw new Error('NO-GO: unexpected upstream Dockerfile change: '+a);
  expected=expected.replace(a,b);
}
if(target!==banner+expected)throw new Error('NO-GO: custom Dockerfile differs from reviewed upstream derivation');
if(!target.includes('COPY lib/integrations/nextcrm/bridge-protocol.ts')||
   !target.includes('COPY integrations/nextcrm-bridge-overlay/app/api/internal/erp-document-authorization/route.ts')){
  throw new Error('NO-GO: missing signed bridge in custom Dockerfile');
}
console.log('PASS: root-context NextCRM Dockerfile matches exact upstream Dockerfile plus reviewed signed bridge');
