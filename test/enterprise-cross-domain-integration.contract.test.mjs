import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('cross-domain costing ledger is additive, owner-scoped, event immutable and reversible',()=>{
 const migration=read('drizzle-pg/0028_enterprise_project_cost_allocations.sql');
 const manifest=read('scripts/migrate-postgres.mjs');
 const api=read('app/api/controlling/project-costs/route.ts');
 const ui=read('app/ProjectCostControlBoard.tsx');
 for(const s of ['enterprise_project_cost_allocations','CISNE_PROJECT_COST_OWNER_INVARIANT',
  'CISNE_PROJECT_COST_IMMUTABLE','CISNE_PROJECT_COST_REVERSAL_INVARIANT'])
  assert.ok(migration.includes(s),s);
 assert.ok(manifest.includes('0028_enterprise_project_cost_allocations'));
 for(const s of ['lockFinancePeriodScope','assertFinancePeriodOpen','COST_ALLOCATION_EXCEEDS_PAYABLE',
  'service_orders','payables','procurement_supplier_invoices','finance_audit_events'])
  assert.ok(api.includes(s),'source invariant '+s);
 for(const s of ['/api/controlling/project-costs','onOrder(selectedId)','action:\'allocate\'','action:\'reverse\''])
  assert.ok(ui.includes(s),'controller action '+s);
});
test('single enterprise exception inbox exposes real source modules without mutations',()=>{
 const route=read('app/api/enterprise/exceptions/route.ts');
 const ui=read('app/EnterpriseExceptionCenter.tsx');
 const center=read('app/EnterpriseCommandCenter.tsx');
 for(const s of ['READ ONLY','supplier_purchase_orders','service_orders',
  'measurements','invoices','accounting_invoice_links','receivables','payables','bank_statement_lines',
  'outstandingExpression','payableBalance','ctx!.actorId'])
  assert.ok(route.includes(s),'exception source '+s);
 assert.ok(!route.includes('export async function POST'));
 assert.ok(ui.includes('/api/enterprise/exceptions?'));
 assert.ok(ui.includes('onOpenOrder(x.orderId)'));
 assert.ok(center.includes('<EnterpriseExceptionCenter navigate={navigate} onOpenOrder={onOpenOrder}/>'));
});
test('transversal wave keeps compact financial shell and both controller contexts without hiding navigation',()=>{
 const overview=read('app/FinanceOverviewWorkspace.tsx');
 const layout=read('app/layout.tsx');
 const page=read('app/page.tsx');
 assert.ok(overview.includes("<ProjectCostControlBoard onOrder={onProjectOrder}"));
 assert.ok(overview.includes("<ControllingIncomeStatement onLedgerAccount={onLedgerAccount}"));
 assert.ok(page.includes("onProjectOrder={id=>navigate('Dossiês empresariais',id)}"));
 assert.ok(layout.includes('enterprise-project-costs.css'));
 assert.ok(layout.includes('enterprise-exceptions.css'));
 for(const cssPath of ['app/components/enterprise/enterprise-project-costs.css',
  'app/components/enterprise/enterprise-exceptions.css']){
  const css=read(cssPath);
  assert.ok(css.includes('max-width:540px'));
  let depth=0;
  for(const char of css){if(char==='{')depth++;if(char==='}')depth--;assert.ok(depth>=0);}
  assert.equal(depth,0);
 }
});
