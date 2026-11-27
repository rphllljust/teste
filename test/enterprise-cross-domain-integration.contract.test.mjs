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

test('procurement P2P object navigates to owner-scoped AP and never fabricates bank/GL postings',()=>{
 const procurement=read('app/ProcurementWorkspace.tsx');
 const board=read('app/ProcureToPayDossierBoard.tsx');
 const payables=read('app/PayablesWorkspace.tsx');
 const page=read('app/page.tsx');
 const route=read('app/api/enterprise/procure-to-pay/[id]/route.ts');
 const source=read('lib/application/procure-to-pay-dossier.ts');
 assert.ok(procurement.includes("activeTab==='chain'"));
 assert.ok(procurement.includes('<ProcureToPayDossierBoard'));
 assert.ok(board.includes('/api/enterprise/procure-to-pay/'));
 assert.ok(board.includes('onOpenPayable(data.payableId!'));
 assert.ok(page.includes('setPayableDrilldown(id)'));
 assert.ok(payables.includes('initialPayableId'));
 for(const marker of ['REPEATABLE READ READ ONLY','po.owner_id=$2',
   'si.owner_id=$2','p.actor_id=$2',"e.kind='match'",'enterprise_project_cost_allocations'])
  assert.ok(source.includes(marker),'P2P tenant/evidence boundary missing: '+marker);
 assert.ok(route.includes('requestContext(request)'));
 assert.ok(route.includes('getProcureToPayDossier(context.actorId,id)'));
});

test('bidirectional native navigation preserves owned P2P document identifiers',()=>{
 const page=read('app/page.tsx'),ap=read('app/PayablesWorkspace.tsx');
 assert.ok(ap.includes('Abrir pedido original em Compras'));
 assert.ok(ap.includes('detail.source.procurement!.orderId'));
 assert.ok(page.includes('setProcurementDrilldown(id)'));
 assert.ok(page.includes('procurementDrilldown||mrpOrderId'));
 assert.ok(page.includes('initialPayableId={payableDrilldown}'));
});
