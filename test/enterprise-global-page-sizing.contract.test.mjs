import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const css=read('app/components/enterprise/enterprise-global-sizing-tier1.css');
const app=read('app/page.tsx');
const layout=read('app/layout.tsx');

test('the same Tier1 layout contract is mounted once and after every domain stylesheet',()=>{
 const path='enterprise-global-sizing-tier1.css';
 assert.equal(layout.split(path).length-1,1);
 assert.match(layout,new RegExp('import "./components/enterprise/'+path.replace(/\./g,'\\.')+'";'));
 assert.ok(layout.lastIndexOf(path)>layout.lastIndexOf('enterprise-finance-preflight.css'),
  'global geometry must load after Financeiro and Controladoria overrides');
 assert.ok(layout.lastIndexOf(path)>layout.lastIndexOf('enterprise-os-object-page-tier1.css'));
 assert.match(app,/className="app" data-layout-system="tier1" data-density=\{density\}/);
 assert.match(app,/data-navigation=\{navigationCollapsed \? "collapsed" : "expanded"\}/);
 assert.match(app,/data-workspace=\{page === "Visão operacional"/);
});
test('one consistent navigation, topbar, content cap, gutters and semantic scale for all modules',()=>{
 const tokens={
  '--cisne-tier1-header: 56px;':'topbar',
  '--cisne-tier1-navigation: 248px;':'expanded navigation',
  '--cisne-tier1-navigation-mini: 64px;':'collapsed navigation',
  '--cisne-tier1-content-max: 1760px;':'work area max',
  '--cisne-tier1-content-gutter: 24px;':'desktop gutter',
  '--cisne-tier1-page-heading: 24px;':'page title',
  '--cisne-tier1-section-heading: 16px;':'section title',
  '--cisne-tier1-body: 14px;':'body',
  '--cisne-tier1-control: 36px;':'control',
  '--cisne-tier1-row: 42px;':'table row',
 };
 for(const [declaration,why] of Object.entries(tokens))
  assert.ok(css.includes(declaration),'Missing '+why+' token');
 for(const marker of [
  '.app[data-layout-system="tier1"] > .sidebar',
  '.app[data-layout-system="tier1"] > .main',
  '.app[data-layout-system="tier1"] > .main > .topbar',
  '.app[data-layout-system="tier1"] > .main > main',
  'max-width: var(--cisne-tier1-content-max) !important',
  '.enterprise-page-header, .heading',
  '.worklist > .list-title',
  '.enterprise-filter-bar',
  '.enterprise-data-grid,.table-wrap',
  '.metrics > button,.enterprise-kpi-card',
 ]){
  assert.ok(css.includes(marker),'Missing global surface: '+marker);
 }
 assert.ok(!css.includes('font-size: 10px !important') &&
  !css.includes('font-size: 9px !important'),
  'No blanket tiny typography masquerading as enterprise density');
});
test('desktop/tablet/mobile and compact/comfortable modes keep one responsive shell',()=>{
 assert.match(css,/@media \(min-width: 801px\)/);
 assert.match(css,/@media \(min-width: 801px\) and \(max-width: 1279px\)/);
 assert.match(css,/@media \(max-width: 800px\)/);
 assert.match(css,/@media \(max-width: 480px\)/);
 assert.match(css,/--cisne-tier1-content-gutter: 20px;/);
 assert.match(css,/--cisne-tier1-content-gutter: 14px;/);
 assert.match(css,/--cisne-tier1-content-gutter: 12px;/);
 assert.match(css,/data-navigation="collapsed"/);
 assert.match(css,/data-density="compact"/);
 assert.match(css,/data-density="comfortable"/);
 assert.match(css,/--cisne-tier1-row: 36px;/);
 assert.match(css,/--cisne-tier1-row: 48px;/);
 assert.match(css,/--cisne-tier1-control: 32px;/);
 assert.match(css,/--cisne-tier1-control: 40px;/);
 assert.ok(css.includes('margin-left: 0 !important;'),'Mobile shell must not keep desktop offset');
});
test('every business module uses the same page frame rather than custom max widths',()=>{
 const modules=['CRMWorkspace','ClientsWorkspace','ContractsWorkspace','ProposalsWorkspace',
 'ExecutionWorkspace','FieldServiceCockpit','FinanceOverviewWorkspace','PayablesWorkspace',
 'PaymentRunsWorkspace','CollectionsWorkspace','CashFlowWorkspace','TreasuryWorkspace',
 'BankReconciliationWorkspace','AccountingWorkspace','LedgerWorkspace','FiscalWorkspace',
 'CloseCenterWorkspace','ProcurementWorkspace','InventoryWorkspace','MRPWorkspace',
 'ProfessionalsWorkspace','AssetsWorkspace','ResourcePlanningBoard','EnterpriseCommandCenter'];
 for(const name of modules)assert.ok(app.includes('<'+name),name+' must remain mounted in ERP shell');
 assert.ok(css.includes('.cisne-crm, .field-service-cockpit, .mrp-workspace'));
 assert.ok(css.includes('.enterprise-dossier, .module-workspace'));
 assert.ok(css.includes('.app.enterprise-governance'));
 assert.ok(css.includes('.enterprise-app-shell .enterprise-page-layout'));
 assert.ok(css.includes('max-width: 100% !important'));
});
test('OS expanded Object Page follows shell tokens, never retains hardcoded 236px/60px',()=>{
 const page=read('app/components/enterprise/enterprise-os-object-page-tier1.css');
 assert.ok(page.includes('var(--cisne-tier1-navigation,248px)'));
 assert.ok(page.includes('var(--cisne-tier1-header,56px)'));
 assert.ok(page.includes('var(--cisne-tier1-content-gutter,24px)'));
 assert.doesNotMatch(page,/inset:60px 0 0 236px|100vw - 236px/);
 assert.ok(css.includes('.main.with-context > main'));
});
test('global design sizing never modifies auth, data model or document permissions',()=>{
 assert.ok(!css.includes('display: none !important;'));
 assert.ok(!css.includes('visibility:hidden'));
 assert.ok(!css.includes('pointer-events: none'));
 assert.ok(!css.includes('position: static !important'));
 assert.ok(!css.includes('.production-login'));
 assert.ok(css.includes('@media (forced-colors: active)'));
 assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'));
});
