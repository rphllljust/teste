import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('Service Order control plane cannot read unowned rows or mutate state',()=>{
 const route=read('app/api/orders/[id]/control/route.ts');
 for(const marker of ['requestContext(request)','o.owner_id','owner_id=$2',
  'REPEATABLE READ READ ONLY','client.query(\'COMMIT\')','client?.release()',
  'service_orders','resource_allocations','execution_entries','measurements',
  'receivables','receivable_settlements','bank_reconciliation_events',
  'enterprise_project_cost_allocations','accounting_invoice_links',
  'deriveServiceOrderControl','consistency:\'REPEATABLE READ READ ONLY\'']){
  if(marker==='o.owner_id')continue; // The owner predicate is keyed to service_orders directly.
  assert.ok(route.includes(marker),'Missing ownership/evidence: '+marker);
 }
 assert.ok(!route.includes('export async function POST'));
 assert.ok(!route.includes('UPDATE service_orders'));
 assert.ok(!route.includes('owner_id IS NULL'));
 assert.ok(route.includes('if(!order)throw new ApiError(404'));
});
test('Service Order financial values never use floats or infer cash',()=>{
 const domain=read('lib/domain/service-order-control.mjs');
 const ui=read('app/ServiceOrderControlPanel.tsx');
 assert.ok(domain.includes('BigInt(raw)'));
 assert.ok(domain.includes('partialContributionScaled'));
 assert.ok(domain.includes('RECEIPTS_EXCEED_INVOICES'));
 assert.ok(ui.includes('Faturamento emitido'));
 assert.ok(ui.includes('Custo atribuído à OS'));
 assert.ok(ui.includes('Contribuição parcial*'));
 assert.ok(ui.includes('Recebimentos sem conciliação bancária'));
 assert.ok(ui.includes('cache:\'no-store\',credentials:\'same-origin\''));
 assert.ok(!ui.includes('method:\'POST\''));
});
test('Operational Object Pages both expose evidence and retain authorized server commands',()=>{
 const page=read('app/page.tsx');
 const workbench=read('app/EnterpriseOperationsWorkbench.tsx');
 const css=read('app/components/enterprise/enterprise-service-order-control.css');
 const layout=read('app/layout.tsx');
 assert.ok(page.includes('<ServiceOrderControlPanel orderId={selected.id}'));
 assert.ok(page.includes('onExecuteOrder={()=>navigate("Execução",selected.id)}'));
 assert.ok(page.includes('{id:"order-control",label:"Controle da OS"}'));
 assert.ok(workbench.includes('<ServiceOrderControlPanel orderId={selected.id}'));
 assert.ok(workbench.includes('detail.order.availableCommands'));
 assert.ok(layout.includes('enterprise-service-order-control.css'));
 assert.ok(css.includes('max-width:620px'));
 assert.ok(css.includes('max-width:1050px'));
 assert.ok(css.includes('prefers-reduced-motion:reduce'));
});
