import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const shell=read('app/page.tsx');
const layout=read('app/layout.tsx');
const css=read('app/components/enterprise/enterprise-finance-tier1.css');
const overview=read('app/FinanceOverviewWorkspace.tsx');
const close=read('app/CloseCenterWorkspace.tsx');

test('financial workspace retains global ERP navigation and scopes visual rules across all financial pages',()=>{
 assert.match(shell,/data-workspace=\{page === "Visão operacional"/);
 assert.match(shell,/\\.includes\\(page\\) \\? "finance" : "standard"/);
 for(const name of ['Visão financeira','Financeiro','Faturamento','Fluxo de caixa','Tesouraria',
  'Contas a pagar','Caixa e conciliação','Razão contábil','Contabilidade','Fiscal e tributos','Fechamentos'])
  assert.ok(shell.includes('"'+name+'"'),'financial module omitted: '+name);
 assert.match(layout,/enterprise-finance-tier1\\.css/);
 assert.match(css,/\\.app\\[data-workspace="finance"\\]/);
 assert.doesNotMatch(css,/cisne-enterprise-global-domains\\s*\\{\\s*display\\s*:\\s*none/);
 for(const width of ['1250px','800px','540px'])assert.ok(css.includes('max-width:'+width));
 assert.match(css,/forced-colors:active/);
 assert.match(css,/prefers-reduced-motion:reduce/);
});
test('finance command center exposes authenticated owner-scoped balances and exception queues without inventing bank cash',()=>{
 for(const route of ['/api/finance/workspace','/api/accounting/reconciliation','/api/accounting/receipt-reconciliation','/api/treasury?page=1'])
  assert.ok(overview.includes(route),'missing authoritative API '+route);
 assert.match(overview,/Promise\\.allSettled/);
 assert.match(overview,/credentials:'same-origin',cache:'no-store'/);
 assert.match(overview,/verifiedCount\\(/);
 assert.match(overview,/assurance\\.treasury\\?\\.pageInfo\\.hasMore/);
 assert.match(overview,/onDrilldown\\(m\\.drilldown\\)/);
 for(const moduleName of ['Contabilidade','Caixa e conciliação','Tesouraria','Fechamentos','Fluxo de caixa','Razão contábil'])
  assert.ok(overview.includes("'"+moduleName+"'"));
 assert.match(overview,/não representam conexão bancária em tempo real/);
 assert.doesNotMatch(overview,/Math\\.random|faker|mockData|method:\\s*['"]POST/);
});
test('bank, treasury, cash, fiscal and ledger provide real corrective actions and source trace',()=>{
 const treasury=read('app/TreasuryWorkspace.tsx');
 const cash=read('app/CashFlowWorkspace.tsx');
 const bank=read('app/BankReconciliationWorkspace.tsx');
 const ledger=read('app/LedgerWorkspace.tsx');
 const fiscal=read('app/FiscalWorkspace.tsx');
 assert.match(treasury,/onImport:\\(\\)=>void/);
 assert.match(treasury,/Abrir importação de extrato/);
 assert.match(cash,/Consultar origem bancária/);
 assert.match(cash,/onNavigate\\('Financeiro'\\)/);
 assert.match(bank,/Importar extrato documentado/);
 assert.match(ledger,/Configurar plano de contas/);
 assert.match(fiscal,/aria-label="Competência fiscal"/);
 assert.match(fiscal,/Correlação: <code>\\{ev\\.correlationId/);
 assert.match(shell,/onImport=\\{\\(\\)=>navigate\\('Caixa e conciliação'\\)\\}/);
});
test('financial close cannot be presented as strict Tier 1 accounting certification',()=>{
 assert.match(close,/tier1Readiness\\?:/);
 assert.match(close,/Prévia sem bloqueios detectados/);
 assert.match(close,/certificação contábil Tier 1 NÃO está pronta/);
 assert.match(close,/aria-label="Prontidão contábil Tier 1"/);
 assert.match(close,/blockerDestinations\\[block\\.code\\]/);
 assert.match(close,/onNavigate\\(item\\.module\\)/);
 assert.match(close,/!preflight\\?\\.canClose/);
 const route=read('app/api/finance/periods/close/route.ts');
 const preflight=read('app/api/finance/periods/preflight/route.ts');
 assert.match(route,/assertPeriodReadyToClose/);
 assert.match(route,/lockFinancePeriodScope/);
 assert.match(preflight,/advisoryOnly:true/);
 assert.match(preflight,/tier1Readiness:/);
});
test('new finance stylesheet has no unterminated selectors',()=>{
 const source=css.replace(/\\/\\*[\\s\\S]*?\\*\\//g,'');
 let depth=0;
 for(const char of source){if(char==='{')depth++;if(char==='}')depth--;assert.ok(depth>=0);}
 assert.equal(depth,0);
});
