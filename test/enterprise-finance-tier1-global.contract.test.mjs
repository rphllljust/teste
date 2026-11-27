import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const shell=read('app/page.tsx');
const layout=read('app/layout.tsx');
const css=read('app/components/enterprise/enterprise-finance-tier1.css');
const overview=read('app/FinanceOverviewWorkspace.tsx');
const close=read('app/CloseCenterWorkspace.tsx');

test('enterprise finance styles are scoped to all financial modules without hiding ERP navigation',()=>{
 assert.ok(shell.includes('data-workspace={page === "Visão operacional"'));
 assert.ok(shell.includes('.includes(page) ? "finance" : "standard"'));
 for(const name of ['Visão financeira','Financeiro','Faturamento','Fluxo de caixa','Tesouraria',
   'Contas a pagar','Caixa e conciliação','Razão contábil','Contabilidade','Fiscal e tributos','Fechamentos'])
  assert.ok(shell.includes('"'+name+'"'),'module missing: '+name);
 assert.ok(layout.includes('enterprise-finance-tier1.css'));
 assert.ok(css.includes('.app[data-workspace="finance"]'));
 assert.ok(!css.includes('.cisne-enterprise-global-domains { display:none'));
 for(const width of ['max-width:1250px','max-width:800px','max-width:540px'])
  assert.ok(css.includes(width),width);
 assert.ok(css.includes('forced-colors:active'));
 assert.ok(css.includes('prefers-reduced-motion:reduce'));
});

test('finance command center uses real authenticated owners and never invents a bank balance',()=>{
 for(const route of ['/api/finance/workspace','/api/accounting/reconciliation',
   '/api/accounting/receipt-reconciliation','/api/treasury?page=1'])
  assert.ok(overview.includes(route),'authoritative route missing '+route);
 for(const feature of ['Promise.allSettled','credentials:',"cache:'no-store'",
   'verifiedCount(', 'pageInfo.hasMore','onDrilldown(m.drilldown)',"onNavigate('Fechamentos')",
   "onNavigate('Fluxo de caixa')","onNavigate('Razão contábil')"])
  assert.ok(overview.includes(feature),'finance invariant missing '+feature);
 assert.ok(overview.includes('não representam conexão bancária em tempo real'));
 for(const unsafe of ['Math.random','faker','mockData',"method:'POST'"])
  assert.ok(!overview.includes(unsafe),'untrusted source '+unsafe);
});

test('cash, bank, treasury, ledger and fiscal provide legitimate paths and event provenance',()=>{
 const treasury=read('app/TreasuryWorkspace.tsx');
 const cash=read('app/CashFlowWorkspace.tsx');
 const bank=read('app/BankReconciliationWorkspace.tsx');
 const ledger=read('app/LedgerWorkspace.tsx');
 const fiscal=read('app/FiscalWorkspace.tsx');
 assert.ok(treasury.includes('onImport:()=>void'));
 assert.ok(treasury.includes('Abrir importação de extrato'));
 assert.ok(cash.includes('Consultar origem bancária'));
 assert.ok(cash.includes("onNavigate('Financeiro')"));
 assert.ok(bank.includes('Importar extrato documentado'));
 assert.ok(ledger.includes('Configurar plano de contas'));
 assert.ok(fiscal.includes('aria-label="Competência fiscal"'));
 assert.ok(fiscal.includes("ev.correlationId||'Não registrada'"));
 assert.ok(shell.includes("onImport={()=>navigate('Caixa e conciliação')}"));
});

test('finance close is differentiated from accounting certification and keeps server locks',()=>{
 for(const item of ['tier1Readiness?:','Prévia sem bloqueios detectados',
  'certificação contábil Tier 1 NÃO está pronta','aria-label="Prontidão contábil Tier 1"',
  'blockerDestinations[block.code]','onNavigate(item.module)','!preflight?.canClose'])
  assert.ok(close.includes(item),'missing close gate '+item);
 const route=read('app/api/finance/periods/close/route.ts');
 const preflight=read('app/api/finance/periods/preflight/route.ts');
 assert.ok(route.includes('assertPeriodReadyToClose'));
 assert.ok(route.includes('lockFinancePeriodScope'));
 assert.ok(preflight.includes('advisoryOnly:true'));
 assert.ok(preflight.includes('tier1Readiness:'));
});
test('finance stylesheet braces are balanced',()=>{
 let count=0;
 for(const char of css){
  if(char==='{') count++;
  if(char==='}') count--;
  assert.ok(count>=0,'unexpected closing brace');
 }
 assert.equal(count,0);
});


test('compact finance cockpit keeps single toolbar, authorized actions and three operational contexts',()=>{
 const view=read('app/FinanceOverviewWorkspace.tsx');
 assert.ok(view.includes('finance-compact-toolbar'));
 assert.ok(view.includes('finance-compact-commands'));
 assert.ok(view.includes('finance-compact-more-menu'));
 assert.ok(view.includes('finance-compact-exceptions'));
 assert.ok(view.includes("setActiveArea('budget')"));
 for(const link of ["onNavigate('Contas a pagar')","onNavigate('Caixa e conciliação')",
  "onNavigate('Lotes de pagamentos')","onNavigate('Cobrança e inadimplência')",
  "onNavigate('Fechamentos')","onNavigate('Razão contábil')"])
  assert.ok(view.includes(link),'command lost: '+link);
 assert.ok(!view.includes('finance-tier1-controlrail'), 'redundant wide secondary action rail must not return');
 assert.ok(!view.includes('finance-command-context'), 'second row of duplicate action bands must not return');
});
test('financial budgets and cash simulation remain functional but secondary forms are collapsed',()=>{
 const budget=read('app/ControllingBudgetBoard.tsx');
 const flow=read('app/CashFlowWorkspace.tsx');
 assert.ok(budget.includes('<details id="finance-budget-create"'));
 assert.ok(budget.includes('<form onSubmit={create}'));
 assert.ok(budget.includes('onClick={()=>void approve(b)}'));
 assert.ok(budget.includes('onSubmit={revise}'));
 assert.ok(flow.includes('<details id="cashflow-scenario-wrapper"'));
 assert.ok(flow.includes('<CashFlowScenarioWorkbench'));
 assert.ok(flow.includes('data.items.length?'));
 assert.ok(flow.includes('finance-source-disclosure'));
});
test('finance compact layout is isolated, balanced and responsive without hiding real operations',()=>{
 const compact=read('app/components/enterprise/enterprise-finance-compact.css');
 assert.ok(layout.indexOf('enterprise-finance-compact.css')>layout.indexOf('enterprise-finance-command.css'));
 for(const selector of ['.app[data-workspace="finance"]','.finance-tier1-metric-grid',
  '.finance-decision-tabs','.finance-compact-commands','.finance-budget-entry',
  '.finance-scenario-disclosure','.finance-tier1-aging-columns','.finance-tier1-task-list',
  'max-width:780px','max-width:540px','focus-visible'])
  assert.ok(compact.includes(selector),'compact invariant missing: '+selector);
 assert.ok(!compact.includes('.cisne-enterprise-global-domains { display:none'));
 const stripped=compact.replace(/\/\*[\s\S]*?\*\//g,'');
 let depth=0;
 for(const char of stripped){
  if(char==='{')depth++;
  if(char==='}')depth--;
  assert.ok(depth>=0,'bad CSS closing brace');
 }
 assert.equal(depth,0);
});
