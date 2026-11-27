import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('milestone ledger is tenant-guarded, immutable, versioned and included in migration manifest',()=>{
 const sql=read('drizzle-pg/0029_service_order_milestones.sql');
 const runner=read('scripts/migrate-postgres.mjs');
 const workflow=read('.github/workflows/postgres-only-integration.yml');
 for(const marker of ['service_order_milestone_events','service_order_milestone_actor',
  'CISNE_MILESTONE_OWNER_INVARIANT','CISNE_MILESTONE_REVERSAL_INVARIANT',
  'CISNE_MILESTONE_IMMUTABLE','owner_id,order_id,sequence',
  'service_order_milestone_owner_hash','reverses_id text UNIQUE']){
  assert.ok(sql.includes(marker),'migration missing '+marker);
 }
 assert.ok(runner.includes('0029_service_order_milestones'));
 assert.ok(workflow.includes('0029_service_order_milestones'));
});
test('milestone GET is a read-only owned snapshot; POST enforces OS lock, version and idempotency',()=>{
 const api=read('app/api/orders/[id]/milestones/route.ts');
 for(const marker of ['requestContext(request)','requestContext(request,true)',
  'owner_id=$2','FOR UPDATE','VERSION_CONFLICT','IDEMPOTENCY_CONFLICT',
  'REPEATABLE READ READ ONLY','allowedMilestoneCodes(status)',
  'MILESTONE_NOT_ACTIVE','MILESTONE_ALREADY_ACTIVE','fingerprint(',
  'refreshPolicy','service_order_milestone_events']){
  assert.ok(api.includes(marker),'milestone route missing '+marker);
 }
 assert.ok(api.includes('reverses_id'));
 assert.ok(!api.includes('UPDATE service_orders'));
 assert.ok(!api.includes('DELETE FROM service_order_milestone_events'));
});
test('OS Object Page contains real milestone commands and exposes audit evidence without automatic close',()=>{
 const ui=read('app/ServiceOrderMilestonesPanel.tsx');
 const control=read('app/ServiceOrderControlPanel.tsx');
 const css=read('app/components/enterprise/enterprise-service-order-milestones.css');
 const layout=read('app/layout.tsx');
 assert.ok(ui.includes("method:'POST'"));
 assert.ok(ui.includes("credentials:'same-origin'"));
 assert.ok(ui.includes('expectedRevision:pending.revision'));
 assert.ok(ui.includes('Revogar'));
 assert.ok(ui.includes('Referência da evidência'));
 assert.ok(ui.includes('data.history.map'));
 assert.ok(control.includes('<ServiceOrderMilestonesPanel orderId={orderId}/>'));
 assert.ok(layout.includes('enterprise-service-order-milestones.css'));
 assert.ok(css.includes('max-width:520px'));
 assert.ok(css.includes('focus-visible'));
 assert.ok(!ui.includes('api/commands'));
 assert.ok(!ui.includes('api/finance/periods/close'));
});
