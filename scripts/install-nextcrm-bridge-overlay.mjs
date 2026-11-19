import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, stat, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UPSTREAM = resolve(ROOT, 'integrations/nextcrm-upstream');
const PIN = 'd3bead9b44efe2cf94d0dfc2948af0f2c9270deb';

function git(...args) { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim(); }
const revision = git('-C', UPSTREAM, 'rev-parse', 'HEAD');
const gitlink = git('ls-tree', 'HEAD', 'integrations/nextcrm-upstream').split(/\s+/)[2];
if (revision !== PIN || gitlink !== PIN) throw new Error('NO-GO: unexpected NextCRM upstream SHA');
const files = [
  ['lib/integrations/nextcrm/bridge-protocol.ts', 'lib/erp-bridge/bridge-protocol.ts'],
  ['integrations/nextcrm-bridge-overlay/app/api/internal/erp-document-authorization/route.ts',
   'app/api/internal/erp-document-authorization/route.ts'],
  ['integrations/nextcrm-bridge-overlay/app/api/internal/erp-document-upload/route.ts',
   'app/api/internal/erp-document-upload/route.ts'],
  ['integrations/nextcrm-bridge-overlay/app/api/internal/erp-document-authorization/__tests__/route.test.ts',
   'app/api/internal/erp-document-authorization/__tests__/route.test.ts'],
  ['integrations/nextcrm-bridge-overlay/app/api/internal/erp-document-authorization/__tests__/route.integration.test.ts',
   'app/api/internal/erp-document-authorization/__tests__/route.integration.test.ts'],
];
for (const [from, to] of files) {
  const source = resolve(ROOT, from);
  const target = resolve(UPSTREAM, to);
  await stat(source); // Missing reviewed source is a hard failure.
  try { await stat(target); throw new Error('NO-GO: overlay target already exists: '+to); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}
const route = await readFile(resolve(UPSTREAM, files[1][1]), 'utf8');
if (!route.includes('documentReadScopeWhere') || !route.includes('accountReadScopeWhere')) {
  throw new Error('NO-GO: bridge does not enforce original NextCRM authorization rules');
}
console.log('Installed reviewed bridge overlay into pinned NextCRM worktree (local build only).');
