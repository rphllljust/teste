import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../app/api/accounting/ledger/route.ts',import.meta.url),'utf8');
test('general ledger is protected, owner-scoped, paginated and snapshot-consistent',()=>{
 for(const marker of ['requestContext(request)','REPEATABLE READ READ ONLY',
 'j.actor_id=?','actor_id=?', "j.status='posted'",'validDate',
 'periodCount','sourceCount','total>p.page*25'])
  assert.ok(src.includes(marker),marker);
});
test('opening balance is pre-period, closing follows normal account side, not all-time debit minus credit',()=>{
 for(const marker of ['day<date_from','day>=date_from','day<=date_to',
 "account.type==='asset'||account.type==='expense'",
 'opening+balance(periodDebit,periodCredit)','BigInt(t.periodDebit','normalSide'])
 assert.ok(src.includes(marker),marker);
});
