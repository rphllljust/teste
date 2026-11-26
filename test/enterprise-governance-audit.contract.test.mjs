import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const page=read('app/enterprise/page.tsx');
const api=read('app/api/enterprise/tenants/[id]/audit/route.ts');

test('enterprise audit uses authenticated member role, active tenant and owner-scoped records',()=>{
 assert.match(api,/requestContext\(request\)/);
 assert.match(api,/t\.id=\$1 AND t\.status='active'/);
 assert.match(api,/m\.actor_id=\$2 AND m\.status='active'/);
 assert.match(api,/\['owner','admin','auditor'\]\.includes\(role\)/);
 assert.match(api,/WHERE tenant_id=\$1/);
 assert.match(api,/ORDER BY created_at DESC,id DESC LIMIT \$4/);
 assert.match(api,/f\.pageSize\+1/);
 assert.match(api,/FOR SHARE OF t,m/);
 assert.doesNotMatch(api,/owner_id IS NULL OR|faker|Math\.random/);
});

test('governance UI shows audit only to permitted roles, without requesting unauthorized rosters',()=>{
 assert.match(page,/const canAudit=\['owner','admin','auditor'\]/);
 assert.match(page,/\['owner','admin'\]\.includes\(role\)/);
 assert.match(page,/id="governance-audit"/);
 assert.match(page,/auditTenant===tenantId/);
 assert.match(page,/auditRequest\.current \+= 1/);
 assert.match(page,/Carregar eventos anteriores/);
 assert.match(page,/correlationId/);
 assert.match(page,/Nenhum evento de permissão localizado/);
});
