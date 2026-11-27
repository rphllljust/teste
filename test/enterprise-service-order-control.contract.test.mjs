import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('OS control remains owner-scoped consistent read model with exact real source facts',()=>{
 const route=read('app/api/orders/[id]/control/route.ts');
 for(const marker of ['requestContext(request)','owner_id=$2','context.actorId',
  'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
  'client.query(\'COMMIT\')','client?.release()',
  'enterprise_project_cost_allocations','resource_allocations',
  'execution_entries','measurements','receivable_settlements','invoices',
  'assessServiceOrderControl','not_linked']){
  // 'not_linked' is intentionally absent; no inferred source stage is inserted.
  if(marker==='not_linked'){assert.ok(!route.includes(marker));continue;}
  assert.ok(route.includes(marker),'OS control invariant '+marker);
 }
 assert.ok(!route.includes('export async function POST'));
});
test('native OS Object Page and operational workbench share precise source links without mutation',()=>{
 const native=read('app/page.tsx'),work=read('app/EnterpriseOperationsWorkbench.tsx');
 const panel=read('app/EnterpriseServiceOrderControlPanel.tsx');
 const layout=read('app/layout.tsx');
 assert.ok(native.includes('id="order-control"'));
 assert.ok(native.includes('<EnterpriseServiceOrderControlPanel key={selected.id}'));
 assert.ok(work.includes('<EnterpriseServiceOrderControlPanel key={selected.id'));
 assert.ok(panel.includes("/api/orders/"));
 assert.ok(panel.includes("+'/control'"));
 assert.ok(panel.includes("navigate('Execução',orderId)"));
 assert.ok(panel.includes("navigate('Dossiês empresariais',orderId)"));
 assert.ok(panel.includes('partialContributionScaled')===false);
 assert.ok(layout.includes('enterprise-service-order-control.css'));
 const css=read('app/components/enterprise/enterprise-service-order-control.css');
 assert.ok(css.includes('@media(max-width:720px)'));
 assert.ok(css.includes('@media(forced-colors:active)'));
});
