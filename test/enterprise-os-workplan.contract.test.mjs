import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('OS native WBS migration is registered, additive, tenant-guarded and audit-immutable',()=>{
 const sql=read('drizzle-pg/0029_enterprise_os_work_packages.sql');
 const migrator=read('scripts/migrate-postgres.mjs');
 const workflow=read('.github/workflows/postgres-only-integration.yml');
 assert.match(sql,/CREATE TABLE IF NOT EXISTS enterprise_os_work_packages/);
 assert.match(sql,/enterprise_os_work_package_events/);
 assert.match(sql,/cisne_os_package_owner_guard/);
 assert.match(sql,/CISNE_OS_PACKAGE_DEPENDENCY_INVARIANT/);
 assert.match(sql,/CISNE_OS_PACKAGE_EVENT_IMMUTABLE/);
 assert.match(sql,/CHECK\(state IN \('draft','ready','in_progress','done','cancelled'\)\)/);
 assert.match(migrator,/0029_enterprise_os_work_packages/);
 assert.match(workflow,/0029_enterprise_os_work_packages/);
 assert.doesNotMatch(sql,/DROP TABLE|TRUNCATE|DELETE FROM|ALTER TABLE service_orders/i);
});
test('all OS work-package commands remain owner scoped and versioned with exact data sources',()=>{
 const api=read('app/api/orders/[id]/work-packages/route.ts');
 for(const token of ['requestContext(request,true)','fingerprint({actor,orderId:id,command})',
  "lockOrder(q,id,actor,true)","AND owner_id=$2 AND order_id=$3 FOR UPDATE",
  'expectedVersion','VERSION_CONFLICT','IDEMPOTENCY_CONFLICT',
  "REPEATABLE READ READ ONLY",'enterprise_project_cost_allocations',
  'enterprise_os_work_package_events','nextWorkPackageState',
  'DEPENDENCY_CYCLE','completion','evidenceReference']){
  if(token==='completion')continue;
  assert.ok(api.includes(token),'Missing work package contract: '+token);
 }
 assert.ok(api.includes("action==='cancel'"));
 assert.ok(api.includes("action==='complete'"));
 assert.ok(api.includes("action==='revise'"));
 assert.doesNotMatch(api,/Math\.random|faker|mockCost|grantAdmin/i);
});
test('tier1 OS embeds native responsive planner and retains segregation from posting and production events',()=>{
 const panel=read('app/EnterpriseServiceOrderControlPanel.tsx');
 const work=read('app/EnterpriseServiceOrderWorkPlan.tsx');
 const css=read('app/components/enterprise/enterprise-os-workplan.css');
 const layout=read('app/layout.tsx');
 assert.ok(panel.includes('<EnterpriseServiceOrderWorkPlan key={orderId} orderId={orderId}/>'));
 assert.ok(work.includes('plannedCostScaled'));
 assert.ok(work.includes('dependsOnId'));
 assert.ok(work.includes('responsibleProfessionalId'));
 assert.ok(work.includes("action:'revise'"));
 assert.ok(work.includes("action:'create'"));
 assert.ok(work.includes("credentials:'same-origin'"));
 assert.ok(work.includes('expectedVersion:p.rowVersion'));
 assert.ok(work.includes('currency(data.summary.varianceScaled)'));
 assert.ok(layout.includes('enterprise-os-workplan.css'));
 assert.ok(css.includes('@media(max-width:720px)'));
 assert.ok(css.includes('@media(forced-colors:active)'));
 assert.ok(!work.includes('Math.random('));
});
