import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {closeDatabase} from '../../db/raw';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {GET as preflight} from '../../app/api/finance/periods/preflight/route';
import {POST as closePeriod} from '../../app/api/finance/periods/close/route';
import {GET as readiness} from '../../app/api/health/ready/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
 throw Error('Cash-period closing integration must use isolated disposable PostgreSQL');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3});
const actor=randomUUID(),outsider=randomUUID(),orderId=randomUUID();
const measurementId=randomUUID(),invoiceId=randomUUID(),receivableId=randomUUID();
const bankAccount=randomUUID(),receivableAccount=randomUUID();
const cashEvents=[randomUUID(),randomUUID()],journalIds=[randomUUID(),randomUUID()];
const preflightPath='/api/finance/periods/preflight?periodStart=2027-05-01&periodEnd=2027-05-31';
const req=(who:string,path:string,body?:unknown)=>setTestIdentity(new Request('http://localhost'+path,{
 method:body===undefined?'GET':'POST',
 headers:{'content-type':'application/json'},
 ...(body===undefined?{}:{body:JSON.stringify(body)}),
}),who);

before(async()=>{
 const now='2026-11-25T13:00:00Z';
 await pool.query(
  "INSERT INTO service_orders(id,owner_id,title,client,category,description,status,created_at) "+
  "VALUES($1,$2,'CI cash close','CI Customer','Service','CI close','completed',$3)",
  [orderId,actor,now],
 );
 await pool.query(
  "INSERT INTO measurements(id,order_id,description,amount,status,created_at) "+
  "VALUES($1,$2,'CI cash close',10000,'billed',$3)",
  [measurementId,orderId,now],
 );
 await pool.query(
  'INSERT INTO invoices(id,measurement_id,order_id,amount,due_date,created_at) '+
  'VALUES($1,$2,$3,10000,$4,$5)',
  [invoiceId,measurementId,orderId,'2027-06-15',now],
 );
 await pool.query(
  'INSERT INTO receivables(id,invoice_id,amount,due_date,created_at) '+
  'VALUES($1,$2,10000,$3,$4)',
  [receivableId,invoiceId,'2027-06-15',now],
 );
 await pool.query(
  "INSERT INTO chart_accounts(id,code,name,type,created_at,actor_id,request_hash) "+
  "VALUES($1,$1,'CI bank','asset',$3,$4,'ci'),($2,$2,'CI AR','asset',$3,$4,'ci')",
  [bankAccount,receivableAccount,now,actor],
 );
});
after(async()=>{await closeDatabase();await pool.end();});

async function putReceipt(i:number,amount:number,date:string){
 await pool.query(
  'INSERT INTO receivable_settlements(id,receivable_id,kind,amount,effective_date,reference,created_at,actor_id,request_hash,correlation_id) '+
  "VALUES($1,$2,'receipt',$3,$4,'Synthetic close probe',$5,$6,$7,'ci')",
  [cashEvents[i],receivableId,amount,date,new Date().toISOString(),actor,randomUUID()],
 );
}
async function putJournalAndLink(i:number,amount:number,settlementDate:string,journalDate:string){
 await pool.query(
  'INSERT INTO journal_entries(id,effective_date,source_reference,description,status,expected_count,created_at,actor_id,request_hash,correlation_id) '+
  "VALUES($1,$2,$3,'Synthetic close probe','posted',2,$4,$5,'ci','ci')",
  [journalIds[i],journalDate,'settlement:'+cashEvents[i],new Date().toISOString(),actor],
 );
 await pool.query(
  'INSERT INTO journal_lines(id,entry_id,account_id,debit,credit) '+
  'VALUES($1,$2,$3,$4,0),($5,$2,$6,0,$4)',
  [randomUUID(),journalIds[i],bankAccount,amount,randomUUID(),receivableAccount],
 );
 await pool.query(
  'INSERT INTO accounting_settlement_links(id,actor_id,settlement_id,journal_id,kind,amount,effective_date,rule_version,request_hash,correlation_id,created_at) '+
  "VALUES($1,$2,$3,$4,'receipt',$5,$6,1,'ci','ci',$7)",
  [randomUUID(),actor,cashEvents[i],journalIds[i],amount,settlementDate,new Date().toISOString()],
 );
}

test('period preflight separates legacy cash gaps from inconsistent persisted GL; closes fail securely',async()=>{
 const health=await readiness();
 assert.equal(health.status,200);
 assert.equal((await health.json() as {ready:boolean}).ready,true);
 assert.equal((await preflight(new Request('http://localhost'+preflightPath))).status,401);
 await putReceipt(0,4000,'2027-05-10');
 const legacy=await preflight(req(actor,preflightPath));
 assert.equal(legacy.status,200);
 const initial=await legacy.json() as {
  canClose:boolean;blockingInvoices:number;invalidCashLinks:number;
  unpostedCashEvents:number;unpostedCashAmountScaled:string;
  tier1Readiness:{ready:boolean;status:'ready'|'blocked';blockers:Array<{code:string;count:number}>};
 };
 assert.equal(initial.blockingInvoices,0);
 assert.equal(initial.invalidCashLinks,0);
 assert.equal(initial.unpostedCashEvents,1);
 assert.equal(initial.unpostedCashAmountScaled,'4000');
 assert.equal(initial.canClose,true); // legacy remains advisory until adopted
 assert.equal(initial.tier1Readiness.ready,false);
 assert.deepEqual(initial.tier1Readiness.blockers.filter(item=>item.code==='unpostedCashEvents'),[{code:'unpostedCashEvents',count:1}]);
 const foreign=await preflight(req(outsider,preflightPath));
 assert.equal((await foreign.json() as {unpostedCashEvents:number}).unpostedCashEvents,0);

 await putJournalAndLink(0,4000,'2027-05-10','2027-05-10');
 const recognized=await preflight(req(actor,preflightPath));
 const cleared=await recognized.json() as typeof initial;
 assert.equal(cleared.unpostedCashEvents,0);
 assert.equal(cleared.invalidCashLinks,0);
 assert.equal(cleared.tier1Readiness.ready,true);
 assert.deepEqual(cleared.tier1Readiness.blockers,[]);

 // Simulate a corrupt source-linked journal while preserving an immutable
 // link: a wrong effective date is forbidden even if its journal balances.
 await putReceipt(1,3000,'2027-05-11');
 await putJournalAndLink(1,3000,'2027-05-11','2027-06-01');
 const broken=await preflight(req(actor,preflightPath));
 assert.equal(broken.status,200);
 const response=await broken.json() as typeof initial;
 assert.equal(response.invalidCashLinks,1);
 assert.equal(response.canClose,false);
 assert.equal(response.tier1Readiness.status,'blocked');
 assert.deepEqual(response.tier1Readiness.blockers.filter(item=>item.code==='invalidCashLinks'),[{code:'invalidCashLinks',count:1}]);
 const closingId=randomUUID();
 const closing=await closePeriod(req(actor,'/api/finance/periods/close',{
  id:closingId,periodStart:'2027-05-01',periodEnd:'2027-05-31',
  reference:'CI must refuse corrupt cash ledger',
 }));
 assert.equal(closing.status,409);
 assert.equal((await closing.json() as {code:string}).code,'FINANCE_CASH_LEDGER_INTEGRITY');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM finance_period_closes WHERE id=$1',
  [closingId])).rows[0].n,0);
});
