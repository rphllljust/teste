import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('native OS List Report uses authenticated enterprise risk projection and contextual drilldown',()=>{
 const rail=read('app/EnterpriseServiceOrderExceptionQueue.tsx');
 const page=read('app/page.tsx');
 const api=read('app/api/enterprise/operations/route.ts');
 for(const marker of ["queue:'attention'","sort:'priority'","credentials:'same-origin'","cache:'no-store'","postgres_owner_scoped_operations",
  "data.summary.overdue","data.summary.unmeasured","data.summary.draft","onOpenOrder(item.id)"]){
  assert.ok(rail.includes(marker),'Risk rail missing: '+marker);
 }
 assert.ok(page.includes('EnterpriseServiceOrderExceptionQueue'));
 assert.ok(page.includes('onOpenControlTower={() => navigate("Visão operacional")}'));
 assert.ok(page.includes('data-os-mode={page === "Ordens de serviço"'));
 assert.ok(page.includes('className="os-agenda-disclosure"'));
 assert.equal((page.match(/<ServiceOperationsAgenda\b/g)??[]).length,1,'One agenda, no duplicate');
 assert.ok(api.includes('o.owner_id=$1'));
 assert.ok(api.includes('enterprise_os_work_packages'));
 assert.ok(api.includes('planOverdue'));
 assert.ok(api.includes('planBlocked'));
 assert.ok(rail.includes('data.summary.planOverdue'));
 assert.ok(rail.includes('data.summary.planBlocked'));

 assert.ok(api.includes("REPEATABLE READ READ ONLY"));
 assert.ok(!rail.includes('Math.random'));
 assert.ok(!rail.includes("method:'POST'"));
});
test('agenda excludes finished and cancelled OS regardless status casing',()=>{
 const agenda=read('app/ServiceOperationsAgenda.tsx');
 assert.ok(agenda.includes("order.status.toLowerCase()"));
 assert.ok(agenda.includes("['completed','cancelled']"));
 assert.ok(agenda.includes("orders.filter(order=>order.due_date&&!isClosed(order))"));
});
test('OS compact layout reserves primary table and preserves all affordances at mobile widths',()=>{
 const css=read('app/components/enterprise/enterprise-os-list-tier1.css');
 const layout=read('app/layout.tsx');
 for(const item of ['main[data-os-mode="list"]','.os-tier1-exceptions-worklist','.os-agenda-disclosure',
  '.metrics','@media(max-width:800px)','@media(forced-colors:active)','@media(prefers-reduced-motion:reduce)'])
  assert.ok(css.includes(item),item);
 assert.ok(layout.includes('enterprise-os-list-tier1.css'));
 assert.ok(!css.includes('display:none!important}.operational-workspace .worklist'));
});
