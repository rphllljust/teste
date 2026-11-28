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

test('0037 preserves every plan revision and only accepts employee work after owner review',async()=>{
 const [sql,migration,app,orders,ownerUi,employeeUi,planUi,reviewUi,integration]=await Promise.all([
  r('drizzle-pg/0037_service_plan_revision_and_acceptance.sql'),
  r('scripts/migrate-postgres.mjs'),
  r('lib/application/service-needs.ts'),
  r('app/api/commands/route.ts'),
  r('app/ServiceNeedsWorkspace.tsx'),
  r('app/ServiceNeedEmployeeFieldPanel.tsx'),
  r('app/ServiceNeedsPlanBuilder.tsx'),
  r('app/ServiceNeedsWorkReviewPanel.tsx'),
  r('test/integration/service-need-to-execution.test.ts'),
 ]);
 for(const table of ['svc_plan_revisions','svc_work_reports','svc_work_report_reviews'])
  assert.ok(sql.includes('CREATE TABLE '+table),'missing immutable table '+table);
 assert.match(sql,/INSERT INTO svc_plan_revisions/);
 assert.match(sql,/svc_work_reports_immutable/);
 assert.match(sql,/svc_work_report_reviews_immutable/);
 assert.match(migration,/0037_service_plan_revision_and_acceptance/);
 for(const command of ['submit_work_report','review_work_report','set_plan'])
  assert.ok(app.includes("case '"+command+"'"),'missing workflow '+command);
 assert.match(app,/PENDING_ADDITIONAL/);
 assert.match(app,/planRevision/);
 assert.match(app,/status='completed'/);
 assert.match(app,/review_pending/);
 assert.match(orders,/\['start','complete','cancel'\]\.includes\(p\.command\)/);
 assert.match(ownerUi,/ServiceNeedsPlanBuilder/);
 assert.match(ownerUi,/ServiceNeedsWorkReviewPanel/);
 assert.match(employeeUi,/submit_work_report/);
 assert.match(planUi,/Publicar nova versão auditável/);
 assert.match(reviewUi,/Aceitar relatório e concluir OS/);
 assert.match(integration,/planHistory\.length/);
 assert.match(integration,/reportSnapshots/);
 assert.doesNotMatch(employeeUi,/approvedInternalCostCents|approvedSalePriceCents|marginBps/);
});

test('0038 closes the audited service-to-cash loop without a billing authorization bypass',async()=>{
 const [sql,manifest,domain,handlers,generic,billing,ui,board,endpoint,readiness,integration]=await Promise.all([
  r('drizzle-pg/0038_service_measurement_finance_bridge.sql'),
  r('scripts/migrate-postgres.mjs'),
  r('lib/application/service-measurements.ts'),
  r('app/api/enterprise/tenants/[id]/service-needs/[needId]/measurements/route.ts'),
  r('app/api/commands/route.ts'),
  r('lib/application/billing.ts'),
  r('app/ServiceNeedsMeasurementPanel.tsx'),
  r('app/ServiceNeedsControlTower.tsx'),
  r('app/api/enterprise/tenants/[id]/service-needs/control-tower/route.ts'),
  r('lib/application/service-go-readiness.ts'),
  r('test/integration/service-need-to-execution.test.ts'),
 ]);
 for(const tab of ['svc_measurement_links','svc_measurement_approvals'])
  assert.match(sql,new RegExp('CREATE TABLE '+tab));
 assert.match(sql,/UNIQUE\(tenant_id,need_id\)/);
 assert.match(sql,/svc_measurement_links_immutable/);
 assert.match(sql,/svc_measurement_approvals_immutable/);
 assert.match(sql,/CISNE_FOUR_EYES/);
 assert.match(manifest,/0038_service_measurement_finance_bridge/);
 assert.match(domain,/accepted report required|Nenhum relatório de campo foi aceito/);
 assert.match(domain,/FOUR_EYES_REQUIRED/);
 assert.match(domain,/commercial_snapshot/);
 assert.match(domain,/COMMERCIAL_LIMIT/);
 assert.match(handlers,/requestContext\(request,true\)/);
 assert.match(handlers,/getServiceMeasurementDossier/);
 assert.match(generic,/medição vinculada ao relatório aceito/);
 assert.match(generic,/aprovação independente de outro controlador/);
 assert.match(billing,/svc_measurement_approvals/);
 assert.match(billing,/svc_measurement_links/);
 assert.match(ui,/Faturar medição aprovada/);
 assert.match(ui,/Conta a receber/);
 assert.match(board,/Centro de controle/);
 assert.match(endpoint,/getServiceControlTower/);
 assert.match(readiness,/measurement_finance_link/);
 for(const pattern of [/measurementPost/,/invoiceCommand/,/four eyes/i,/auto_posted/,/controlTowerGet/])
  assert.match(integration,pattern);
});
