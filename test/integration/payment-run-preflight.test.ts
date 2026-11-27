import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {closeDatabase} from '../../db/raw';
import {POST as prepare} from '../../app/api/finance/payment-runs/route';
import {GET as preflight} from '../../app/api/finance/payment-runs/[id]/preflight/route';
const conn=process.env.DATABASE_URL;
if(process.env.NODE_ENV!=='test'||!conn)throw Error('Disposable PostgreSQL required');
const uri=new URL(conn);
if(!['localhost','127.0.0.1'].includes(uri.hostname)||!['/cisne_ci','/cisne_test'].includes(uri.pathname))
 throw Error('NO-GO: financial tests must not mutate shared PostgreSQL');
const pool=new Pool({connectionString:conn,max:2});
const owner=randomUUID(),other=randomUUID(),payable=randomUUID(),run=randomUUID(),now=new Date().toISOString();
const on=(actor:string,url:string,body?:unknown)=>setTestIdentity(new Request('http://localhost'+url,{
 method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined}),actor);
const route=(actor:string)=>preflight(on(actor,'/api/finance/payment-runs/'+run+'/preflight'),{params:Promise.resolve({id:run})});
type Result={canExecute:boolean;advisoryOnly:boolean;blockers:Array<{code:string}>;
 rowVersion:number;scope:string;summary:{totalScaled:string;itemCount:number;staleCount:number;accountingPosting:string}};
before(async()=>{
 await pool.query('INSERT INTO payables(id,supplier,source_reference,description,amount,due_date,created_at,actor_id,request_hash,correlation_id) '+
  'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[payable,'CI AP PREFLIGHT','CI-PREVIEW',
    'Disposable obligation',150000,'2029-02-20',now,owner,'ci','preview']);
});
after(async()=>{await closeDatabase();await pool.end();});
test('preflight is owner scoped, read only and flags actual state transitions',async()=>{
 const prepared=await prepare(on(owner,'/api/finance/payment-runs',{id:run,reference:'CI readiness batch',
  effectiveDate:'2029-02-20',items:[{payableId:payable,amount:'12.0000'}]}));
 assert.equal(prepared.status,201);
 const otherUser=await route(other);
 assert.equal(otherUser.status,404);
 let response=await route(owner);
 assert.equal(response.status,200);
 let result=await response.json() as Result;
 assert.equal(result.canExecute,true);
 assert.equal(result.advisoryOnly,true);
 assert.equal(result.scope,'authenticated_owner');
 assert.equal(result.summary.totalScaled,'120000');
 assert.equal(result.summary.itemCount,1);
 assert.equal(result.summary.accountingPosting,'not_enabled');
 const beforeEvents=await pool.query('SELECT COUNT(*)::int AS n FROM finance_payment_run_events WHERE run_id=$1',[run]);
 assert.equal(Number(beforeEvents.rows[0].n),1);
 const item=await pool.query('SELECT payment_key FROM finance_payment_run_items WHERE run_id=$1',[run]);
 await pool.query("INSERT INTO payable_payments(id,payable_id,kind,amount,effective_date,reference,created_at,actor_id,request_hash,correlation_id) "+
  "VALUES($1,$2,'payment',$3,$4,$5,$6,$7,$8,$9)",[item.rows[0].payment_key,payable,10000,'2029-02-19','CI stale collision',
   now,owner,'ci','preflight']);
 response=await route(owner);
 result=await response.json() as Result;
 assert.equal(result.canExecute,false);
 assert.ok(result.blockers.some(x=>x.code==='PAYMENT_RUN_STALE'));
 assert.ok(result.blockers.some(x=>x.code==='PAYMENT_RUN_COLLISION'));
 assert.equal(result.summary.staleCount,1);
 const closed=randomUUID();
 await pool.query("INSERT INTO finance_period_closes(id,period_start,period_end,status,actor_id,request_hash,correlation_id,closed_at) "+
  "VALUES($1,'2029-02-01','2029-02-28','closed',$2,'ci','ci',$3)",
  [closed,owner,now]);
 response=await route(owner);result=await response.json() as Result;
 assert.ok(result.blockers.some(x=>x.code==='FINANCE_PERIOD_CLOSED'));
 const afterEvents=await pool.query('SELECT COUNT(*)::int AS n FROM finance_payment_run_events WHERE run_id=$1',[run]);
 assert.equal(Number(afterEvents.rows[0].n),1,'read-only preflight cannot emit financial events');
});
