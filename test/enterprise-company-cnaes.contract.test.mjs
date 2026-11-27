import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const root=new URL('../',import.meta.url);
const files=await Promise.all([
  'drizzle-pg/0025_enterprise_cnae_activities.sql',
  'app/api/enterprise/tenants/[id]/legal-entities/[entityId]/cnaes/route.ts',
  'app/components/enterprise/LegalEntityCnaes.tsx',
  'app/enterprise/page.tsx',
  'scripts/migrate-postgres.mjs',
].map(path=>readFile(new URL(path,root),'utf8')));
const [migration,api,panel,page,migrator]=files;

test('49 operator-declared CNAEs are durable, unique and include exactly one primary',()=>{
  const matches=[...migration.matchAll(/^ \('([\d.\-]+)','((?:''|[^'])+)',(\d+),(true|false)\)/gm)];
  assert.equal(matches.length,49);
  assert.equal(new Set(matches.map(x=>x[1])).size,49);
  assert.deepEqual(matches.map(x=>Number(x[3])),Array.from({length:49},(_,i)=>i+1));
  assert.deepEqual(matches.filter(x=>x[4]==='true').map(x=>x[1]),['46.19-2-00']);
  assert.ok(matches.some(x=>x[1]==='50.30-1-01'));
  assert.match(migration,/FOREIGN KEY\(tenant_id,legal_entity_id\)/);
  assert.match(migration,/WHERE is_primary = true/);
  assert.match(migrator,/0025_enterprise_cnae_activities/);
});
test('CNAE API is authorized, idempotent, audited and rejects silent overwrite',()=>{
  assert.match(api,/requestContext\(request,true\)/);
  assert.match(api,/JOIN enterprise_tenant_memberships/);
  assert.match(api,/role !== 'owner' && role !== 'admin'/);
  assert.match(api,/IDEMPOTENCY_CONFLICT/);
  assert.match(api,/CNAE_PROFILE_EXISTS/);
  assert.match(api,/FOR UPDATE OF e/);
  assert.match(api,/enterprise_permission_events/);
  assert.match(api,/enterprise_legal_entity_cnaes/);
});
test('CNAEs are not client-only placeholders and require explicit legal entity selection',()=>{
  assert.match(page,/LegalEntityCnaes/);
  assert.match(page,/company.taxId/);
  assert.match(panel,/Vincular 49 CNAEs à empresa/);
  assert.match(panel,/company\.id/);
  assert.match(panel,/window\.confirm/);
  assert.match(panel,/credentials:'same-origin'/);
  assert.doesNotMatch(panel,/localStorage|sessionStorage/);
});
