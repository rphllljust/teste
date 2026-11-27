import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {closeDatabase} from '../../db/raw';
import {GET,POST} from '../../app/api/controlling/budgets/route';
import {POST as budgetCommand} from '../../app/api/controlling/budgets/commands/route';
if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)throw Error('Disposable PostgreSQL required');
const uri=new URL(process.env.DATABASE_URL);
if(!['127.0.0.1','localhost'].includes(uri.hostname)||!['/cisne_ci','/cisne_test'].includes(uri.pathname))
 throw Error('Never run financial mutation tests against shared database');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});
const a=randomUUID(),b=randomUUID(),account=randomUUID(),offsetAccount=randomUUID(),id=randomUUID();
const journals=[randomUUID(),randomUUID()];
const request=(owner:string,path:string,data?:object)=>setTestIdentity(new Request('http://localhost'+path,{
 method:data?'POST':'GET',headers:{'content-type':'application/json'},body:data?JSON.stringify(data):undefined}),owner);
after(async()=>{try{
 await pool.query("DELETE FROM business_commands WHERE entity_type='controllingBudget' AND entity_id=$1",[id]);
 await pool.query("DELETE FROM finance_audit_events WHERE entity_type='controlling_budget' AND actor_id=$1",[a]);
 await pool.query('DELETE FROM journal_lines WHERE entry_id=ANY($1::text[])',[journals]);
 await pool.query('DELETE FROM journal_entries WHERE id=ANY($1::text[])',[journals]);
 await pool.query('DELETE FROM controlling_budgets WHERE id=$1',[id]);
 await pool.query('DELETE FROM chart_accounts WHERE id=ANY($1::text[])',[[account,offsetAccount]]);
}finally{await closeDatabase();await pool.end();}});
test('controlling budgets are persisted, isolated and approved exactly once',async()=>{
 await pool.query("INSERT INTO chart_accounts(id,code,name,type,active,created_at,actor_id,request_hash) VALUES($1,$2,'CI Budget','expense',1,$3,$4,'ci')",
 [account,'CI-'+randomUUID().slice(0,8),new Date().toISOString(),a]);
 const payload={id,accountId:account,periodMonth:'2027-04',plannedScaled:'9007199254741000',reference:'Centro de custo operacao'};
 assert.equal((await POST(request(a,'/api/controlling/budgets',payload))).status,201);
 assert.equal((await POST(request(a,'/api/controlling/budgets',payload))).status,200);
 const before=await (await GET(request(a,'/api/controlling/budgets?periodMonth=2027-04'))).json() as {summary:{plannedScaled:string};items:Array<{actualScaled:string}>};
 assert.equal(before.summary.plannedScaled,'0');
 assert.equal(before.items[0].actualScaled,'0');
 assert.equal((await POST(request(b,'/api/controlling/budgets',{...payload,id:randomUUID()}))).status,409);
 const revise={key:randomUUID(),budgetId:id,expectedVersion:1,command:'revise',plannedScaled:'9007199254741001',reference:'Revisado CI'};
 assert.equal((await budgetCommand(request(a,'/api/controlling/budgets/commands',revise))).status,201);
 assert.equal((await budgetCommand(request(a,'/api/controlling/budgets/commands',revise))).status,200);
 assert.equal((await budgetCommand(request(a,'/api/controlling/budgets/commands',{...revise,key:randomUUID()}))).status,409);
 const cmd={key:randomUUID(),budgetId:id,expectedVersion:2,command:'approve'};
 assert.equal((await budgetCommand(request(b,'/api/controlling/budgets/commands',cmd))).status,404);
 assert.equal((await budgetCommand(request(a,'/api/controlling/budgets/commands',cmd))).status,201);
 assert.equal((await budgetCommand(request(a,'/api/controlling/budgets/commands',cmd))).status,200);
 assert.equal((await budgetCommand(request(a,'/api/controlling/budgets/commands',{...cmd,key:randomUUID()}))).status,409);
 const approved=await (await GET(request(a,'/api/controlling/budgets?periodMonth=2027-04'))).json() as {summary:{plannedScaled:string;actualScaled:string}};
 assert.equal(approved.summary.plannedScaled,'9007199254741001');
 assert.equal(approved.summary.actualScaled,'0');
 await pool.query("INSERT INTO chart_accounts(id,code,name,type,active,created_at,actor_id,request_hash) VALUES($1,$2,'Cash offset','asset',1,$3,$4,'ci')",
  [offsetAccount,'CI-OFF-'+randomUUID().slice(0,8),new Date().toISOString(),a]);
 for(let i=0;i<2;i++){
  const amount=i===0?30000:10000;
  await pool.query("INSERT INTO journal_entries(id,effective_date,source_reference,description,status,expected_count,created_at,actor_id,request_hash,correlation_id) VALUES($1,'2027-04-11',$2,'Budget CI booked','posted',2,$3,$4,'ci','ci')",
    [journals[i],'budget-ci-'+randomUUID(),new Date().toISOString(),a]);
  const debit=i===0?account:offsetAccount,credit=i===0?offsetAccount:account;
  await pool.query('INSERT INTO journal_lines(id,entry_id,account_id,debit,credit) VALUES($1,$2,$3,$4,0),($5,$2,$6,0,$4)',
    [randomUUID(),journals[i],debit,amount,randomUUID(),credit]);
 }
 const realized=await (await GET(request(a,'/api/controlling/budgets?periodMonth=2027-04'))).json() as {summary:{plannedScaled:string;actualScaled:string;deviationScaled:string}};
 assert.equal(realized.summary.actualScaled,'20000','expense budget reflects net posted ledger after credit corrections');
 assert.equal(realized.summary.deviationScaled,(20000n-9007199254741001n).toString());

 assert.equal(((await (await GET(request(b,'/api/controlling/budgets?periodMonth=2027-04'))).json()) as {items:unknown[]}).items.length,0);
});
