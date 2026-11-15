import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const upstreamSha='d3bead9b44efe2cf94d0dfc2948af0f2c9270deb';
const upstreamRev=execFileSync('git',['-C','integrations/nextcrm-upstream','rev-parse','HEAD'],{encoding:'utf8'}).trim();
const gitlink=execFileSync('git',['ls-tree','HEAD','integrations/nextcrm-upstream'],{encoding:'utf8'}).trim().split(/\s+/)[2];
if(upstreamRev!==upstreamSha||gitlink!==upstreamSha)throw new Error('NO-GO: NextCRM upstream SHA mismatch');
const upstream=await readFile('integrations/nextcrm-upstream/Dockerfile','utf8');
const target=await readFile('Dockerfile.nextcrm','utf8');
const banner="# CISNE NextCRM stage image: generated from upstream Dockerfile at gitlink\n# d3bead9b44efe2cf94d0dfc2948af0f2c9270deb, plus reviewed private bridge.\n# CI verifies byte-level derivation. Source must include initialized submodules.\n# Build with: docker build -f Dockerfile.nextcrm -t nextcrm-candidate .\n";
const substitutions=[
  [
    "COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./",
    "COPY integrations/nextcrm-upstream/pnpm-lock.yaml integrations/nextcrm-upstream/pnpm-workspace.yaml integrations/nextcrm-upstream/package.json ./"
  ],
  [
    "COPY . .",
    "COPY integrations/nextcrm-upstream/ .\n# Install the reviewed ERP bridge on top of the pinned upstream worktree.\nCOPY lib/integrations/nextcrm/bridge-protocol.ts ./lib/erp-bridge/bridge-protocol.ts\nCOPY integrations/nextcrm-bridge-overlay/app/api/internal/erp-document-authorization/route.ts ./app/api/internal/erp-document-authorization/route.ts"
  ],
  [
    "COPY --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh",
    "COPY --from=build --chown=nextjs:nodejs /app/docker-entrypoint.sh ./docker-entrypoint.sh"
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
