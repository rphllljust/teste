import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const r=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
test('0034 is registered and additive',async()=>{
 const [m,sql]=await Promise.all([r('scripts/migrate-postgres.mjs'),r('drizzle-pg/0034_service_need_to_execution.sql')]);
 assert.match(m,/0034_service_need_to_execution/);
 assert.doesNotMatch(sql,/DROP\s+TABLE|TRUNCATE|ALTER\s+TABLE\s+(?!svc_)/i);
 assert.match(sql,/tenant_id text NOT NULL REFERENCES enterprise_tenants/);
});
test('service need flow never calls fiscal transmission and gates owners server-side',async()=>{
 const app=await r('lib/application/service-needs.ts');
 assert.doesNotMatch(app,/sefaz|prefeitura|nfse|fiscal/i);
 assert.match(app,/identity_state='verified'/);
 assert.match(app,/'draft'/);
 for(const c of ['approve','release','assign','add_additional'])assert.ok(app.includes('case \''+c+'\''));
});
