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

test('0035 is additive with immutable pricing, commercial history and employee field audit',async()=>{
 const [m,sql,app,form,employee]=await Promise.all([
  r('scripts/migrate-postgres.mjs'),r('drizzle-pg/0035_service_ops_enterprise_commercial_field.sql'),
  r('lib/application/service-needs.ts'),r('app/ServiceNeedsCommercialPanel.tsx'),r('app/ServiceNeedEmployeeFieldPanel.tsx')
 ]);
 assert.match(m,/0035_service_ops_enterprise_commercial_field/);
 assert.doesNotMatch(sql,/DROP\s+TABLE|TRUNCATE|ALTER\s+TABLE\s+(?!svc_)/i);
 for(const table of ['svc_commercial_terms_versions','svc_commercial_documents','svc_commercial_price_lines','svc_field_events','svc_additional_requests','svc_additional_decisions'])
  assert.ok(sql.includes('CREATE TABLE '+table),'missing '+table);
 for(const command of ['set_commercial_terms','register_commercial_document','register_price_line','record_field_event','request_additional','decide_additional'])
  assert.ok(app.includes("case '"+command+"'"),'missing business command '+command);
 assert.match(app,/CISNE_SERVICE_NEED_APPEND_ONLY|COMMERCIAL_LIMIT/);
 assert.match(app,/requestHash/);
 assert.match(form,/Custo interno unitário/);
 assert.match(employee,/record_field_event/);
 assert.match(employee,/request_additional/);
 assert.doesNotMatch(employee,/InternalCost|SalePrice|margin|preço de venda/i);
});
