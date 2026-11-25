import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {closeDatabase} from '../../db/raw';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {POST as configureRule,GET as ruleDetails} from '../../app/api/accounting/posting-rules/route';
import {POST as bill} from '../../app/api/finance/billing/route';
import {POST as settle} from '../../app/api/finance/receivables/settlements/route';
import {POST as reverseSettlement} from '../../app/api/finance/receivables/settlements/[id]/reverse/route';
import {POST as reverseJournal} from '../../app/api/accounting/journals/[id]/reverse/route';
import {GET as cashReconciliation} from '../../app/api/accounting/receipt-reconciliation/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
 throw new Error('Real PostgreSQL and NODE_ENV=test required for cash ledger suite.');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3});
const actor=randomUUID(),outsider=randomUUID(),orderId=randomUUID();
const measurements=[randomUUID(),randomUUID()];
const assetAR=randomUUID(),assetBank=randomUUID(),revenue=randomUUID();
const routeRule='/api/accounting/posting-rules',routeBill='/api/finance/billing';
const routeSettle='/api/finance/receivables/settlements';
const makeRequest=(who:string,path:string,payload?:unknown)=>setTestIdentity(new Request('http://localhost'+path,{
 method:payload===undefined?'GET':'POST',headers:{'content-type':'application/json'},
 ...(payload===undefined?{}:{body:JSON.stringify(payload)}),
}),who);
const rule=(sourceType:'invoice_billing'|'receivable_receipt',debitId:string,creditId:string,version=0,active=true)=>({
 sourceType,debitAccountId:debitId,creditAccountId:creditId,
 expectedVersion:version,active,commandKey:randomUUID(),
});
const linkCount=async(id:string)=>(await pool.query(
 'SELECT count(*)::int AS n FROM accounting_settlement_links WHERE settlement_id=$1',[id],
)).rows[0].n as number;

before(async()=>{
 const now=new Date().toISOString();
 await pool.query(
  "INSERT INTO service_orders(id,owner_id,title,client,category,description,status,version,created_at) "+
  "VALUES($1,$2,'Cash ledger','CI customer','Service','CI','completed',1,$3)",
  [orderId,actor,now],
 );
 for(const measurementId of measurements){
  await pool.query(
   "INSERT INTO measurements(id,order_id,description,amount,status,version,created_at) "+
   "VALUES($1,$2,'Approved',25000,'approved',1,$3)",
   [measurementId,orderId,now],
  );
 }
 await pool.query(
  "INSERT INTO chart_accounts(id,code,name,type,created_at,actor_id,request_hash) "+
  "VALUES($1,$1,'CI AR','asset',$4,$5,'ci'),"+
  "($2,$2,'CI bank','asset',$4,$5,'ci'),"+
  "($3,$3,'CI revenue','revenue',$4,$5,'ci')",
  [assetAR,assetBank,revenue,now,actor],
 );
});
after(async()=>{
 // The database is a disposable CI instance; append-only links and audit
 // evidence intentionally survive until the ephemeral PostgreSQL is discarded.
 await closeDatabase();await pool.end();
});

test('native receipt posting enforces recognized A/R, journal reversal chain, idempotency and period integrity',async()=>{
 const invoiceRule=await configureRule(makeRequest(actor,routeRule,
  rule('invoice_billing',assetAR,revenue)));
 assert.equal(invoiceRule.status,201,JSON.stringify(await invoiceRule.clone().json()));
 const creation=await bill(makeRequest(actor,routeBill,{
  measurementId:measurements[0],dueDate:'2027-06-30',commandKey:randomUUID(),
 }));
 assert.equal(creation.status,201,JSON.stringify(await creation.clone().json()));
 const invoiceData=await creation.json() as {resource:{invoiceId:string;receivableId:string;accounting:{journalId:string}}};
 const receivableId=invoiceData.resource.receivableId;
 const invoiceJournalId=invoiceData.resource.accounting.journalId;

 const legacyKey=randomUUID();
 const legacy=await settle(makeRequest(actor,routeSettle,{
  receivableId,amount:'5000',effectiveDate:'2027-04-10',reference:'Legacy receipt',commandKey:legacyKey,
 }));
 assert.equal(legacy.status,201);
 assert.equal((await legacy.json() as {resource:{accounting:{status:string}}}).resource.accounting.status,'not_enabled');
 assert.equal(await linkCount(legacyKey),0);
 const legacyRecon=await cashReconciliation(makeRequest(actor,'/api/accounting/receipt-reconciliation'));
 assert.equal(legacyRecon.status,200);
 assert.deepEqual((await legacyRecon.json() as {summary:{eventCount:number;postedEvents:number;unpostedEvents:number}}).summary.eventCount,1);
 const outsiderRecon=await cashReconciliation(makeRequest(outsider,'/api/accounting/receipt-reconciliation'));
 assert.equal((await outsiderRecon.json() as {summary:{eventCount:number}}).summary.eventCount,0);
 const wrong=await configureRule(makeRequest(actor,routeRule,
  rule('receivable_receipt',assetBank,revenue)));
 assert.equal(wrong.status,409);
 assert.equal((await wrong.json() as {code:string}).code,'ACCOUNTING_CLASSIFICATION_MISMATCH');

 const policyInput=rule('receivable_receipt',assetBank,assetAR);
 const policy=await configureRule(makeRequest(actor,routeRule,policyInput));
 assert.equal(policy.status,201,JSON.stringify(await policy.clone().json()));
 assert.equal((await configureRule(makeRequest(actor,routeRule,policyInput))).status,200);
 assert.equal((await ruleDetails(makeRequest(actor,routeRule+'?sourceType=receivable_receipt'))).status,200);
 const originalRule=await ruleDetails(makeRequest(actor,routeRule));
 assert.equal((await originalRule.json() as {rule:{sourceType:string}}).rule.sourceType,'invoice_billing');

 const receiptKey=randomUUID(),receiptInput={
  receivableId,amount:'7000',effectiveDate:'2027-04-11',reference:'Bank remittance',commandKey:receiptKey,
 };
 assert.equal((await settle(makeRequest(outsider,routeSettle,receiptInput))).status,404);
 const settled=await Promise.all([
  settle(makeRequest(actor,routeSettle,receiptInput)),
  settle(makeRequest(actor,routeSettle,receiptInput)),
 ]);
 assert.deepEqual(settled.map(x=>x.status).sort(),[200,201]);
 const body=await settled.find(x=>x.status===201)!.json() as {resource:{
  accounting:{status:string;journalId:string;ruleVersion:number};balance:string;
 }};
 assert.equal(body.resource.accounting.status,'auto_posted');
 assert.equal(body.resource.accounting.ruleVersion,1);
 assert.equal(body.resource.balance,'13000');
 const retry=await settled.find(x=>x.status===200)!.json() as typeof body;
 assert.equal(retry.resource.accounting.journalId,body.resource.accounting.journalId);
 assert.equal(await linkCount(receiptKey),1);
 const dbLines=await pool.query(
  'SELECT account_id,debit,credit FROM journal_lines WHERE entry_id=$1 ORDER BY debit DESC',
  [body.resource.accounting.journalId],
 );
 assert.deepEqual(dbLines.rows,[
  {account_id:assetBank,debit:7000,credit:0},
  {account_id:assetAR,debit:0,credit:7000},
 ]);

 const unauthorizedJournalReversal=await reverseJournal(makeRequest(actor,
  '/api/accounting/journals/'+body.resource.accounting.journalId+'/reverse',{
   commandKey:randomUUID(),effectiveDate:'2027-04-12',
   sourceReference:'WRONG-DIRECT-REV',description:'Bypass origin',
  }),{params:Promise.resolve({id:body.resource.accounting.journalId})});
 assert.equal(unauthorizedJournalReversal.status,409);
 assert.equal((await unauthorizedJournalReversal.json() as {code:string}).code,'ACCOUNTING_SOURCE_REVERSAL_REQUIRED');

 const invoiceReverse=await reverseJournal(makeRequest(actor,
  '/api/accounting/journals/'+invoiceJournalId+'/reverse',{
   commandKey:randomUUID(),effectiveDate:'2027-04-12',
   sourceReference:'WRONG-INVOICE-REV',description:'Cash dependency',
  }),{params:Promise.resolve({id:invoiceJournalId})});
 assert.equal(invoiceReverse.status,409);
 assert.equal((await invoiceReverse.json() as {code:string}).code,'ACCOUNTING_SETTLEMENT_DEPENDENCY');

 const reversalKey=randomUUID();
 const reversePath=routeSettle+'/'+receiptKey+'/reverse';
 const reverseInput={
  commandKey:reversalKey,effectiveDate:'2027-04-12',reference:'Bank return',
 };
 const reversed=await reverseSettlement(makeRequest(actor,reversePath,reverseInput),{
  params:Promise.resolve({id:receiptKey}),
 });
 assert.equal(reversed.status,201,JSON.stringify(await reversed.clone().json()));
 const reversalInfo=await reversed.json() as {resource:{accounting:{status:string;journalId:string}}};
 assert.equal(reversalInfo.resource.accounting.status,'auto_reversed');
 assert.equal(await linkCount(reversalKey),1);
 const reconAfterReversal=await cashReconciliation(makeRequest(actor,'/api/accounting/receipt-reconciliation'));
 assert.equal(reconAfterReversal.status,200);
 const reconBody=await reconAfterReversal.json() as {summary:{eventCount:number;postedEvents:number;unpostedEvents:number;reversals:number;netLedgerAmountScaled:string;netSettlementAmountScaled:string}};
 assert.equal(reconBody.summary.eventCount,3);
 assert.equal(reconBody.summary.postedEvents,2);
 assert.equal(reconBody.summary.unpostedEvents,1);
 assert.equal(reconBody.summary.reversals,1);
 assert.equal(reconBody.summary.netLedgerAmountScaled,'0');
 assert.equal(reconBody.summary.netSettlementAmountScaled,'5000');
 const journalLink=await pool.query('SELECT reversal_of FROM journal_entries WHERE id=$1',
  [reversalInfo.resource.accounting.journalId]);
 assert.equal(journalLink.rows[0].reversal_of,body.resource.accounting.journalId);
 const reversalLines=await pool.query(
  'SELECT account_id,debit,credit FROM journal_lines WHERE entry_id=$1 ORDER BY credit DESC',
  [reversalInfo.resource.accounting.journalId],
 );
 assert.deepEqual(reversalLines.rows,[
  {account_id:assetBank,debit:0,credit:7000},
  {account_id:assetAR,debit:7000,credit:0},
 ]);
 const reverseReplay=await reverseSettlement(makeRequest(actor,reversePath,reverseInput),{
  params:Promise.resolve({id:receiptKey}),
 });
 assert.equal(reverseReplay.status,200);
 assert.equal((await reverseReplay.json() as typeof reversalInfo).resource.accounting.journalId,
  reversalInfo.resource.accounting.journalId);
 assert.equal((await reverseSettlement(makeRequest(actor,reversePath,{
  ...reverseInput,commandKey:randomUUID(),
 }),{params:Promise.resolve({id:receiptKey})})).status,409);

 const immutable=await pool.query('SELECT id FROM accounting_settlement_links WHERE settlement_id=$1',[receiptKey]);
 await assert.rejects(pool.query('DELETE FROM accounting_settlement_links WHERE id=$1',
  [immutable.rows[0].id]),/CISNE_SETTLEMENT_LINK_IMMUTABLE/);

 // Active cash posting refuses an invoice without a recognized GL origin.
 await configureRule(makeRequest(actor,routeRule,
  rule('invoice_billing',assetAR,revenue,1,false)));
 const unposted=await bill(makeRequest(actor,routeBill,{
  measurementId:measurements[1],dueDate:'2027-06-30',commandKey:randomUUID(),
 }));
 assert.equal(unposted.status,201);
 const unpostedReceivable=(await unposted.json() as {resource:{receivableId:string}}).resource.receivableId;
 const refusedKey=randomUUID();
 const refused=await settle(makeRequest(actor,routeSettle,{
  receivableId:unpostedReceivable,amount:'1000',effectiveDate:'2027-04-13',
  reference:'Unrecognized invoice',commandKey:refusedKey,
 }));
 assert.equal(refused.status,409);
 assert.equal((await refused.json() as {code:string}).code,'CASH_RECEIPT_ORIGIN_UNRECOGNIZED');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM receivable_settlements WHERE id=$1',
  [refusedKey])).rows[0].n,0);

 // Closing the receipt's period bars reversal through a later-dated command.
 const lockedKey=randomUUID();
 const last=await settle(makeRequest(actor,routeSettle,{
  receivableId,amount:'3000',effectiveDate:'2027-04-14',
  reference:'Locked receipt',commandKey:lockedKey,
 }));
 assert.equal(last.status,201);
 await pool.query(
  "INSERT INTO finance_period_closes(id,period_start,period_end,status,actor_id,request_hash,correlation_id,closed_at) "+
  "VALUES($1,'2027-04-01','2027-04-30','closed',$2,$3,'ci',$4)",
  [randomUUID(),actor,randomUUID(),new Date().toISOString()],
 );
 const closed=await reverseSettlement(makeRequest(actor,routeSettle+'/'+lockedKey+'/reverse',{
  commandKey:randomUUID(),effectiveDate:'2027-05-15',reference:'After period close',
 }),{params:Promise.resolve({id:lockedKey})});
 assert.equal(closed.status,409);
 assert.equal((await closed.json() as {code:string}).code,'ACCOUNTING_CLOSED_ORIGIN');
});
