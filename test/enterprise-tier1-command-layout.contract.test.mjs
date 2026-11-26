import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const workbench=read('app/EnterpriseOperationsWorkbench.tsx');
const shell=read('app/page.tsx');
const grid=read('app/components/enterprise/EnterpriseSmartGrid.tsx');
const layout=read('app/layout.tsx');
const css=read('app/components/enterprise/enterprise-operations-tier1.css');

test('the command center separates operational work, analytics and finance while retaining authenticated evidence',()=>{
 assert.match(workbench,/useState<'work'\|'insights'\|'finance'>\('work'\)/);
 assert.match(workbench,/role="tablist"/);
 for(const tab of ['cisne-view-work','cisne-view-insights','cisne-view-finance'])assert.ok(workbench.includes(tab));
 assert.match(workbench,/surface==='insights'&&/);
 assert.match(workbench,/surface==='finance'&&/);
 assert.match(workbench,/surface==='work'/);
 assert.match(workbench,/<EnterpriseOperationsAnalytics/);
 assert.match(workbench,/<EnterpriseFinancialAssurance/);
 assert.match(workbench,/fetch\('\/api\/enterprise\/operations\?'\+params/);
 assert.match(workbench,/fetch\('\/api\/orders\/'\+encodeURIComponent\(selectedId\)/);
 assert.doesNotMatch(workbench,/Math\.random|mockOrders|faker/);
});
test('worklist is legible, keyboard-operable, owner-scoped and does not mutate transactions',()=>{
 assert.match(workbench,/key:'evidence',title:'Evidências'/);
 assert.match(workbench,/row\.evidence\.executions/);
 assert.match(workbench,/row\.evidence\.measurements/);
 assert.match(workbench,/row\.evidence\.invoices/);
 assert.match(workbench,/activeKey=\{selectedId\}/);
 assert.match(workbench,/cisne-workstation-mobile-list/);
 assert.match(workbench,/onClick=\{\(\)=>inspectOrder\(row\)\}/);
 assert.match(workbench,/event\.key==='Escape'/);
 assert.match(workbench,/onOpenOrder\(selected\.id\)/);
 assert.match(grid,/activeKey\?:Key\|null/);
 assert.match(grid,/aria-selected=\{activeKey!=null/);
 assert.doesNotMatch(workbench,/method:\s*['"]POST['"]/);
});
test('responsive inspector is a scoped drawer, legacy shell and all business domains remain intact',()=>{
 assert.match(shell,/data-workspace=\{page === "Visão operacional"/);
 assert.match(layout,/enterprise-operations-tier1\.css/);
 assert.match(css,/min-width:1100px/);
 assert.match(css,/max-width:1060px/);
 assert.match(css,/max-width:800px/);
 assert.match(css,/max-width:540px/);
 assert.match(css,/data-mobile-inspector="open"/);
 assert.match(css,/cisne-workstation-mobile-list/);
 assert.match(css,/forced-colors:active/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(workbench,/role=\{narrow&&mobileInspectorOpen\?'dialog'/);
 assert.match(workbench,/Comandos|Transições autorizadas/);
});
test('accounting exceptions stay visible on the work tab with no fabricated zeros',()=>{
 const ribbon=read('app/components/enterprise/EnterpriseAccountingExceptionRibbon.tsx');
 assert.match(workbench,/<EnterpriseAccountingExceptionRibbon revision={revision} onOpen=\{\(\)=>setSurface\('finance'\)\}/);
 assert.match(ribbon,/\/api\/accounting\/reconciliation/);
 assert.match(ribbon,/\/api\/accounting\/receipt-reconciliation/);
 assert.match(ribbon,/Promise\.allSettled/);
 assert.match(ribbon,/cache:'no-store',credentials:'same-origin'/);
 assert.match(ribbon,/Number\.isSafeInteger/);
 assert.match(ribbon,/===null\?'Faturas: indisponível'/);
 assert.doesNotMatch(ribbon,/faker|Math\.random|mockInvoices/);
});

test('Tier 1 connects 14-stage PostgreSQL journeys, exact dossier and owner-scoped audit to the object inspector',()=>{
 const journey=read('app/components/enterprise/EnterpriseProcessJourneyInspector.tsx');
 const audit=read('app/components/enterprise/EnterpriseOrderAuditTimeline.tsx');
 const auditRoute=read('app/api/orders/[id]/audit/route.ts');
 const dossiers=read('app/EnterpriseDossierWorkspace.tsx');
 assert.match(workbench,/<EnterpriseProcessJourneyInspector/);
 assert.match(workbench,/<EnterpriseOrderAuditTimeline/);
 assert.match(workbench,/navigate\('Dossiês empresariais',selected\.id\)/);
 assert.match(journey,/\/api\/enterprise\/journeys\//);
 assert.match(journey,/ownerScoped!==true/);
 assert.match(journey,/repeatable_read/);
 assert.match(journey,/onDossier\(orderId\)/);
 assert.match(dossiers,/initialOrderId/);
 assert.match(audit,/\/api\/orders\//);
 assert.match(audit,/correlationId/);
 assert.match(auditRoute,/REPEATABLE READ READ ONLY/);
 assert.match(auditRoute,/WHERE id=\$1 AND owner_id=\$2/);
 assert.match(auditRoute,/FROM field_measurement_events/);
 assert.doesNotMatch(workbench,/method:\s*['"]POST['"]/);
});
test('contextual transitions require a fresh authorized read and keep the existing transactional confirmation',()=>{
 const center=read('app/EnterpriseCommandCenter.tsx');
 assert.match(workbench,/onCommandOrder\?\.\(selected\.id,command\.id\)/);
 assert.match(center,/onCommandOrder=\{onCommandOrder\}/);
 assert.match(shell,/async function openAuthorizedContextCommand/);
 assert.match(shell,/fetch\('\/api\/orders\/'\+encodeURIComponent\(id\),\{cache:'no-store',credentials:'same-origin'\}\)/);
 assert.match(shell,/value\.order\.availableCommands\?\.find/);
 assert.match(shell,/command\(commandId,value\.order\)/);
 assert.match(shell,/navigate\('Ordens de serviço',id\)/);
 assert.match(workbench,/Nenhum comando é executado pelo inspetor/);
});

test('cross-module stage navigation preserves the selected OS for scoped views',()=>{
 const journey=read('app/components/enterprise/EnterpriseProcessJourneyInspector.tsx');
 const dossier=read('app/EnterpriseDossierWorkspace.tsx');
 assert.match(journey,/navigate\(stage\.module,\['Execução','Medições','Faturamento','Financeiro'\]/);
 assert.match(dossier,/navigate\(stage\.module,\['Execução','Medições','Faturamento','Financeiro'\]/);
 assert.match(shell,/if\(name==='Execução'\)setExecutionOrder\(orderId\)/);
 assert.match(shell,/setBusinessOrder\(orderId\)/);
 assert.match(shell,/initialOrderId=\{businessOrder\|\|null\}/);
});
