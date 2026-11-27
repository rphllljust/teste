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
const a=randomUUID(),b=randomUUID(),account=randomUUID(),id=randomUUID();
const request=(owner:string,path:string,data?:object)=>setTestIdentity(new Request('http://localhost'+path,{
 method:data?'POST':'GET',headers:{'content-type':'application/json'},body:data?JSON.stringify(data):undefined}),owner);
after(async()=>{try{
 await pool.query("DELETE FROM business_commands WHERE entity_type='controllingBudget' AND entity_id=$1",[id]);
 await pool.query("DELETE FROM finance_audit_events WHERE entity_type='controlling_budget' AND actor_id=$1",[a]);
 await pool.query('DELETE FROM controlling_budgets WHERE id=$1',[id]);
 await pool.query('DELETE FROM chart_accounts WHERE id=$1',[account]);
}finally{await closeDatabase();await pool.end();}});
test('controlling budgets are persisted, isolated and approved exactly once',async()=>{
 await pool.query("INSERT INTO chart_accounts(id,code,name,type,active,created_at,actor_id,request_hash) VALUES($1,$2,'CI Budget','expense',1,$3,$4,'ci')",
 [account,'CI-'+randomUUID().slice(0,8),new Date().toISOString(),a]);
 const payload={id,accountId:account,periodMonth:'2027-04',plannedScaled:'9007199254741000',reference:'Centro de custo operacao'};
 assert.equal((await POST(request(a,'/api/controlling/budgets',payload))).status,201);
 assert.equal((await POST(request(a,'/api/controlling/budgets',payload))).status,200);
 const before=await (await GET(request(a,'/api/controlling/budgets?periodMonth=2027-04'))).json();
 assert.equal(before.summary.plannedScaled,'0');
 assert.equal(before.items[0].actualScaled,'0');
 assert.equal((await POST(request(b,'/api/controlling/budgets',{...payload,id:randomUUID()}))).status,409);
 const cmd={key:randomUUID(),budgetId:id,expectedVersion:1,command:'approve'};
 assert.equal((await budgetCommand(request(b,'/api/controlling/budgets/commands',cmd))).status,404);
 assert.equal((await budgetCommand(request(a,'/api/controlling/budgets/commands',cmd))).status,201);
 assert.equal((await budgetCommand(request(a,'/api/controlling/budgets/commands',cmd))).status,200);
 assert.equal((await budgetCommand(request(a,'/api/controlling/budgets/commands',{...cmd,key:randomUUID()}))).status,409);
 const approved=await (await GET(request(a,'/api/controlling/budgets?periodMonth=2027-04'))).json();
 assert.equal(approved.summary.plannedScaled,'9007199254741000');
 assert.equal(approved.summary.actualScaled,'0');
 assert.equal((await (await GET(request(b,'/api/controlling/budgets?periodMonth=2027-04'))).json()).items.length,0);
});
