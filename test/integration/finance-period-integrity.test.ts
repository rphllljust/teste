import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {closeDatabase} from '../../db/raw';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {GET as preflight} from '../../app/api/finance/periods/preflight/route';
import {POST as close} from '../../app/api/finance/periods/close/route';
import {POST as journal} from '../../app/api/accounting/journals/route';
import {POST as link} from '../../app/api/accounting/invoice-links/route';
import {POST as reverse} from '../../app/api/accounting/journals/[id]/reverse/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
 throw new Error('Period close integration requires disposable PostgreSQL and NODE_ENV=test');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3});
const actor=randomUUID(),stranger=randomUUID(),orderId=randomUUID(),measurementId=randomUUID();
const invoiceId=randomUUID(),receivableId=randomUUID(),debitId=randomUUID(),creditId=randomUUID();
const journalId=randomUUID(),periodId=randomUUID();
const start='2027-05-01',end='2027-05-31';
const path='/api/finance/periods/preflight?periodStart='+start+'&periodEnd='+end;
const req=(identity:string,location:string,body?:unknown)=>setTestIdentity(new Request('http://localhost'+location,{
 method:body===undefined?'GET':'POST',
 headers:{'content-type':'application/json'},
 ...(body===undefined?{}:{body:JSON.stringify(body)}),
}),identity);
const command={id:periodId,periodStart:start,periodEnd:end,reference:'Homologação de encerramento'};

before(async()=>{
 const now='2027-05-08T12:00:00Z';
 await pool.query(
  "INSERT INTO service_orders(id,owner_id,title,client,category,description,status,version,created_at) "+
  "VALUES($1,$2,'Close CI','CI Customer','Service','CI','completed',1,$3)",
  [orderId,actor,now],
 );
 await pool.query(
  "INSERT INTO measurements(id,order_id,description,amount,status,version,created_at) "+
  "VALUES($1,$2,'Close CI measurement',65000,'billed',2,$3)",
  [measurementId,orderId,now],
 );
 await pool.query(
  'INSERT INTO invoices(id,measurement_id,order_id,amount,due_date,created_at) VALUES($1,$2,$3,65000,$4,$5)',
  [invoiceId,measurementId,orderId,'2027-06-10',now],
 );
 await pool.query(
  'INSERT INTO receivables(id,invoice_id,amount,due_date,created_at) VALUES($1,$2,65000,$3,$4)',
  [receivableId,invoiceId,'2027-06-10',now],
 );
 await pool.query(
  "INSERT INTO chart_accounts(id,code,name,type,created_at,actor_id,request_hash) "+
  "VALUES($1,$1,'A/R','asset',$3,$2,'ci'),($4,$4,'Revenue','revenue',$3,$2,'ci')",
  [debitId,actor,now,creditId],
 );
});
after(async()=>{
 // Append-only invoice link and audit fixtures stay in disposable CI PostgreSQL
 // until the test service is destroyed: never weaken production immutability.
 await closeDatabase();await pool.end();
});

test('pre-close reconciliation blocks unposted invoices, accepts verified period journals and protects closed origins',async()=>{
 assert.equal((await preflight(new Request('http://localhost'+path))).status,401);
 const foreign=await preflight(req(stranger,path));
 assert.equal(foreign.status,200);
 assert.equal((await foreign.json() as {blockingInvoices:number}).blockingInvoices,0);
 const preview=await preflight(req(actor,path));
 assert.equal(preview.status,200);
 const blocked=await preview.json() as {blockingInvoices:number;blockingAmountScaled:string;canClose:boolean;advisoryOnly:boolean};
 assert.equal(blocked.blockingInvoices,1);
 assert.equal(blocked.blockingAmountScaled,'65000');
 assert.equal(blocked.canClose,false);
 assert.equal(blocked.advisoryOnly,true);

 const denied=await close(req(actor,'/api/finance/periods/close',command));
 assert.equal(denied.status,409);
 assert.equal((await denied.json() as {code:string}).code,'FINANCE_CLOSE_BLOCKED');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM finance_period_closes WHERE id=$1',[periodId])).rows[0].n,0);

 const posted=await journal(req(actor,'/api/accounting/journals',{
  id:journalId,effectiveDate:'2027-05-08',sourceReference:'CI-CLOSE-INVOICE',
  description:'Accrual of invoice revenue',
  lines:[
   {id:randomUUID(),accountId:debitId,debit:'65000',credit:'0'},
   {id:randomUUID(),accountId:creditId,debit:'0',credit:'65000'},
  ],
 }));
 assert.equal(posted.status,201,JSON.stringify(await posted.clone().json()));
 const linked=await link(req(actor,'/api/accounting/invoice-links',{
  id:randomUUID(),commandKey:randomUUID(),invoiceId,journalId,
 }));
 assert.equal(linked.status,201,JSON.stringify(await linked.clone().json()));
 const ready=await preflight(req(actor,path));
 assert.equal((await ready.json() as {blockingInvoices:number}).blockingInvoices,0);

 const closed=await close(req(actor,'/api/finance/periods/close',command));
 assert.equal(closed.status,201,JSON.stringify(await closed.clone().json()));
 assert.equal((await close(req(actor,'/api/finance/periods/close',command))).status,200);
 const audit=await pool.query(
  "SELECT metadata FROM finance_audit_events WHERE entity_type='finance_period' AND entity_id=$1",[periodId],
 );
 assert.equal(audit.rows.length,1);
 assert.equal(JSON.parse(String(audit.rows[0].metadata)).closeGate.blockingInvoices,0);

 const noReverse=await reverse(req(actor,'/api/accounting/journals/'+journalId+'/reverse',{
  commandKey:randomUUID(),effectiveDate:'2027-06-01',
  sourceReference:'CI-AFTER-CLOSE',description:'Attempt to invalidate locked source',
 }),{params:Promise.resolve({id:journalId})});
 assert.equal(noReverse.status,409);
 assert.equal((await noReverse.json() as {code:string}).code,'ACCOUNTING_CLOSED_ORIGIN');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM journal_entries WHERE reversal_of=$1',[journalId])).rows[0].n,0);
});
