import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const [sql,migrator,api,ui,workspace]=await Promise.all(['drizzle-pg/0033_cisne_dual_owner_declarations.sql','scripts/migrate-postgres.mjs','app/api/enterprise/owners/route.ts','app/components/enterprise/EnterpriseOwnerDeclarations.tsx','app/EnterpriseGovernanceWorkspace.tsx'].map(path=>readFile(new URL(path,root),'utf8')));
test('Abrahim and Rafael are persisted as two equally declared owners, without fake actor IDs',()=>{
 assert.match(sql,/cisne_erp_owner_declarations/);
 assert.match(sql,/VALUES \('abrahim','Abrahim','owner','unlinked'\),/);
 assert.match(sql,/\('rafael','Rafael','owner','unlinked'\)/);
 assert.match(sql,/identity_actor_id text UNIQUE/);
 assert.match(sql,/cisne_erp_owner_verified_identity/);
 assert.match(migrator,/0033_cisne_dual_owner_declarations/);
});
test('owners endpoint is read-only and does not grant permissions',()=>{
 assert.match(api,/requestContext\(request\)/);
 assert.doesNotMatch(api,/export async function POST|UPDATE cisne_erp_owner_declarations/);
 assert.match(api,/FROM cisne_erp_owner_declarations/);
 assert.match(api,/\.bind\(\)\.all\(\)/);
 assert.doesNotMatch(api,/identity_actor_id AS/);
 assert.match(ui,/Proprietários declarados do CISNE ERP/);
 assert.match(ui,/Aguardando identificação da conta de acesso/);
 assert.match(workspace,/<EnterpriseOwnerDeclarations \/>/);
 assert.ok(workspace.indexOf('<EnterpriseOwnerDeclarations />')<workspace.indexOf('id="governance-organizations"'));
});
