import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../app/api/finance/aging/route.ts',import.meta.url),'utf8');
test('portfolio aging is owner scoped and READ ONLY in a repeatable-read transaction',()=>{
 for(const marker of ['requestContext(request)','REPEATABLE READ READ ONLY','WHERE o.owner_id=?','WHERE p.actor_id=?','WHERE s.actor_id=?',
  'latest_imported_statement_per_account.v1','availableCashScaled:null','consolidated:false','validAsOf'])
  assert.ok(src.includes(marker),marker);
});
test('aging includes five bounded buckets, reversals, and scaled integer SQL totals',()=>{
 for(const marker of ['not_due','overdue_1_30','overdue_31_60','overdue_61_90','overdue_91_plus','COALESCE(SUM(amount),0)::text',
  '::bigint AS amount','b.amount>0','undo.reverses_id=m.id','current_outstanding_by_due_date'])
  assert.ok(src.includes(marker),marker);
 assert.ok(!src.includes('Number(r?.value'));
});
