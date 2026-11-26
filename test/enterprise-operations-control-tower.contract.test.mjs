import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const api=read('app/api/enterprise/operations/route.ts');
const workbench=read('app/EnterpriseOperationsWorkbench.tsx');
const command=read('app/EnterpriseCommandCenter.tsx');
const field=read('app/FieldServiceCockpit.tsx');
const page=read('app/page.tsx');
const css=read('app/components/enterprise/enterprise-operations-workbench.css');
const layout=read('app/layout.tsx');

test('operational API denies unowned objects and uses a repeatable-read snapshot',()=>{
 assert.match(api,/context=requestContext\(request\)/);
 assert.match(api,/o\.owner_id=\$1/);
 assert.doesNotMatch(api,/owner_id IS NULL OR/);
 assert.match(api,/BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
 assert.match(api,/await client\.query\('COMMIT'\)/);
 assert.match(api,/client\?\.release\(\)/);
 assert.match(api,/max\(50\)/);
 assert.match(api,/pageSize<total/);
 assert.match(api,/postgres_owner_scoped_operations/);
 assert.match(api,/COUNT\(\*\) FILTER\(WHERE/);
 assert.match(api,/EXISTS \(SELECT 1 FROM measurements done/);
 assert.match(api,/COUNT\(\*\)::int AS total/);
 assert.match(api,/to_char\(CURRENT_DATE,'YYYY-MM-DD'\)/);
});

test('center of operations is a real List Report with filtered/total distinction',()=>{
 assert.match(workbench,/fetch\('\/api\/enterprise\/operations\?'\+params/);
 assert.match(workbench,/cache:'no-store',credentials:'same-origin'/);
 assert.match(workbench,/queue:'attention'|mode==='field'\?'executing':'attention'/);
 assert.match(workbench,/<EnterpriseSmartGrid viewId=\{'operations-'\+mode\}/);
 assert.match(workbench,/data\.pageInfo\.total/);
 assert.match(workbench,/summary\?\.total/);
 assert.match(workbench,/summary\?\.overdue/);
 assert.match(workbench,/summary\?\.unmeasured/);
 assert.match(workbench,/summary\?\.draft/);
 assert.match(workbench,/onClick=\{\(\)=>selectQueue\(item\.key\)\}/);
 assert.match(workbench,/aria-pressed=\{queue===item\.key\}/);
 assert.match(workbench,/Não existe|Nenhum comando de transição disponível/);
 assert.doesNotMatch(workbench,/faker|mockOrders|Math\.random\(/i);
});

test('Object Page fetches owner-scoped detail and exposes only real allowed commands',()=>{
 assert.match(workbench,/fetch\('\/api\/orders\/'\+encodeURIComponent\(selectedId\)/);
 assert.match(workbench,/<EnterpriseObjectSummary type="Ordem de serviço"/);
 assert.match(workbench,/detail\.order\.availableCommands/);
 assert.match(workbench,/onClick=\{\(\)=>onOpenOrder\(selected\.id\)\}/);
 assert.match(workbench,/navigate\('Dossiês empresariais'\)/);
 assert.match(workbench,/navigate\('Resource Planning Board'\)/);
 assert.match(workbench,/detail\.order\.sublists\?\.history/);
 assert.doesNotMatch(workbench,/fetch\('\/api\/commands'\)|method:'POST'/);
});

test('Visão operacional and Field Service share enterprise source, without double chain on dashboard',()=>{
 assert.match(command,/<EnterpriseOperationsWorkbench navigate=\{navigate\}/);
 assert.match(field,/<EnterpriseOperationsWorkbench mode="field"/);
 assert.match(command,/showMap&&<div className="enterprise-command-navigation-content"/);
 assert.match(command,/<nav className="value-stream" aria-label="Jornada empresarial entre módulos">/);
 assert.match(page,/"Dossiês empresariais",\s*"Visão operacional",\s*\]\.includes\(page\)/);
 assert.match(page,/\[\s*"Ordens de serviço",\s*"Execução",\s*"Medições"/);
 assert.ok(layout.includes('enterprise-operations-workbench.css'));
 assert.match(css,/\.enterprise-operations-body/);
 assert.match(css,/@media\(max-width:720px\)/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(css,/forced-colors:active/);
});

test('Tier 1 executive analytics are owner scoped and never invent financial values',()=>{
 const analytics=read('app/EnterpriseOperationsAnalytics.tsx');
 const financial=read('app/components/enterprise/EnterpriseFinancialAssurance.tsx');
 const menu=read('app/components/enterprise/EnterpriseGlobalDomainNav.tsx');
 const workspace=read('app/components/enterprise/enterprise-workbench.css');
 assert.match(api,/statusBreakdown/);
 assert.match(api,/dueBreakdown/);
 assert.match(api,/WHERE o\.owner_id=\$1/);
 assert.match(api,/BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
 assert.match(api,/analytics:/);
 assert.match(workbench,/<EnterpriseOperationsAnalytics/);
 assert.match(workbench,/<EnterpriseFinancialAssurance/);
 assert.match(analytics,/statusBuckets/);
 assert.match(analytics,/dueBuckets/);
 assert.match(analytics,/navigate\('Financeiro'\)/);
 assert.doesNotMatch(analytics,/faker|Math\.random|mockOrders|R\$ 345|91,7%/i);
 assert.match(financial,/api\/finance\/workspace/);
 assert.match(financial,/api\/accounting\/reconciliation/);
 assert.match(financial,/api\/accounting\/receipt-reconciliation/);
 assert.match(financial,/Promise\.allSettled/);
 assert.match(financial,/BigInt\(scaled\)/);
 assert.match(menu,/currentPage=|currentPage:string/);
 assert.match(menu,/aria-current=/);
 assert.match(page,/EnterpriseGlobalDomainNav/);
 assert.match(workspace,/\.cisne-enterprise-global-domains/);
});

test('legacy ownership and execution revisions are fail closed',()=>{
 const list=read('app/api/orders/route.ts');
 const execution=read('app/api/orders/[id]/execution/route.ts');
 const linked=read('lib/projections/operation.ts');
 const linkedDetail=read('app/api/operation/[kind]/[id]/route.ts');
 const fin=read('app/api/finance/workspace/route.ts');
 const commands=read('app/api/commands/route.ts');
 for(const file of [list,execution,linked,linkedDetail,fin,commands])
  assert.doesNotMatch(file,/owner_id IS NULL OR owner_id/);
 assert.match(execution,/VERSION_CONFLICT/);
 assert.match(execution,/NOT EXISTS \(SELECT 1 FROM execution_entries reversal/);
 assert.match(commands,/m\.id=\$1 AND o\.owner_id=\$2 FOR UPDATE/);
});

test('finance close exposes strict Tier 1 readiness and performance indexes are registered',()=>{
 const preflight=read('app/api/finance/periods/preflight/route.ts');
 const migration=read('drizzle-pg/0024_enterprise_owner_query_indexes.sql');
 const runner=read('scripts/migrate-postgres.mjs');
 assert.match(preflight,/tier1Readiness:/);
 assert.match(preflight,/unpostedCashEvents/);
 assert.match(preflight,/unpostedPayables/);
 assert.match(preflight,/unpostedPayablePayments/);
 assert.match(preflight,/ready:tier1Blockers\.length===0/);
 assert.match(migration,/CREATE INDEX IF NOT EXISTS cisne_orders_owner_status_due_idx/);
 assert.match(migration,/CREATE INDEX IF NOT EXISTS cisne_journal_actor_effective_idx/);
 assert.match(runner,/0024_enterprise_owner_query_indexes/);
});
