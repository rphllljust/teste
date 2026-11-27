import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {closeDatabase} from '../../db/raw';
import {POST,GET} from '../../app/api/bank/reconciliation-batches/route';
import {GET as listStatements} from '../../app/api/bank/statements/route';
import {GET as listTreasury} from '../../app/api/treasury/route';
import {POST as singleBankCommand} from '../../app/api/bank/commands/route';
if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)throw Error('Disposable PG required');
const u=new URL(process.env.DATABASE_URL);
if(!['127.0.0.1','localhost'].includes(u.hostname)||!['/cisne_ci','/cisne_test'].includes(u.pathname))
 throw Error('Refusing reconciliation mutation against shared PostgreSQL');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});
const owner=randomUUID(),foreign=randomUUID(),statement=randomUUID();
const line=[randomUUID(),randomUUID()],payable=[randomUUID(),randomUUID()],payment=[randomUUID(),randomUUID()];
const batch=randomUUID();
const req=(actor:string,body:object)=>setTestIdentity(new Request('http://localhost/api/bank/reconciliation-batches',
 {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),actor);
const items=line.map((lineId,i)=>({lineId,targetType:'payment',targetId:payment[i]}));
after(async()=>{try{
 await pool.query("DELETE FROM business_commands WHERE id=$1",[batch]);
 await pool.query("DELETE FROM finance_audit_events WHERE entity_type='bank_reconciliation_batch' AND entity_id=$1",[batch]);
 await pool.query('DELETE FROM bank_reconciliation_events WHERE line_id=ANY($1::text[])',[line]);
 await pool.query('DELETE FROM bank_statement_lines WHERE statement_id=$1',[statement]);
 await pool.query('DELETE FROM bank_statements WHERE id=$1',[statement]);
 await pool.query('DELETE FROM payable_payments WHERE id=ANY($1::text[])',[payment]);
 await pool.query('DELETE FROM payables WHERE id=ANY($1::text[])',[payable]);
}finally{await closeDatabase();await pool.end();}});
test('batch preview is read-only; invalid line aborts all; valid commit is atomic and replayable',async()=>{
 const now=new Date().toISOString();
 for(let i=0;i<2;i++){
  await pool.query('INSERT INTO payables(id,supplier,source_reference,description,amount,due_date,created_at,actor_id,request_hash,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
   [payable[i],'Fornecedor CI',randomUUID(),'CI reconciliation',i===0?10000:20000,'2027-06-21',now,owner,'ci',randomUUID()]);
  await pool.query("INSERT INTO payable_payments(id,payable_id,kind,amount,effective_date,reference,created_at,actor_id,request_hash,correlation_id) VALUES($1,$2,'payment',$3,$4,$5,$6,$7,$8,$9)",
   [payment[i],payable[i],i===0?10000:20000,'2027-06-21','CI',now,owner,'ci',randomUUID()]);
 }
 await pool.query("INSERT INTO bank_statements(id,account_reference,source_reference,period_start,period_end,opening_balance,closing_balance,expected_count,status,created_at,actor_id,request_hash,correlation_id) VALUES($1,'CI-bank',$2,'2027-06-01','2027-06-30',0,-30000,2,'imported',$3,$4,'ci',$5)",
 [statement,randomUUID(),now,owner,randomUUID()]);
 for(let i=0;i<2;i++)await pool.query('INSERT INTO bank_statement_lines(id,statement_id,external_key,booked_date,description,amount) VALUES($1,$2,$3,$4,$5,$6)',
  [line[i],statement,randomUUID(),'2027-06-21','CI outgoing',i===0?-10000:-20000]);
 const payload={key:batch,statementId:statement,items};
 assert.equal((await POST(req(owner,{...payload,mode:'preview'}))).status,200);
 assert.equal((await pool.query('SELECT id FROM bank_reconciliation_events WHERE line_id=ANY($1::text[])',[line])).rowCount,0);
 assert.equal((await POST(req(foreign,{...payload,mode:'commit'}))).status,404);
 assert.equal((await POST(req(owner,{...payload,items:[items[0],{...items[1],targetId:randomUUID()}],mode:'commit'}))).status,404);
 assert.equal((await pool.query('SELECT id FROM bank_reconciliation_events WHERE line_id=ANY($1::text[])',[line])).rowCount,0);
 assert.equal((await POST(req(owner,{...payload,mode:'commit'}))).status,201);
 assert.equal((await POST(req(owner,{...payload,mode:'commit'}))).status,200);
 assert.equal((await pool.query('SELECT id FROM bank_reconciliation_events WHERE line_id=ANY($1::text[])',[line])).rowCount,2);
 assert.equal((await POST(req(owner,{...payload,key:randomUUID(),mode:'commit'}))).status,409);
 const list=(path:string,actor:string)=>setTestIdentity(new Request('http://localhost'+path),actor);
 const beforeUnmatch=await (await listStatements(list('/api/bank/statements?accountReference=CI-bank',owner))).json() as {items:Array<{id:string;unmatchedCount:string|number}>};
 assert.equal(Number(beforeUnmatch.items.find(x=>x.id===statement)?.unmatchedCount),0,'fully matched bank statement has no pending lines');
 const treasuryBefore=await (await listTreasury(list('/api/treasury',owner))).json() as {items:Array<{statementId:string;unmatchedCount:string|number}>};
 assert.equal(Number(treasuryBefore.items.find(x=>x.statementId===statement)?.unmatchedCount),0);
 const event=(await pool.query("SELECT id FROM bank_reconciliation_events WHERE line_id=$1 AND kind='match'",[line[0]])).rows[0].id as string;
 const unmatchKey=randomUUID();
 const unmatch={key:unmatchKey,statementId:statement,lineId:line[0],command:'unmatch',version:1,matchId:event};
 const unmatched=await singleBankCommand(req(owner,unmatch));
 assert.equal(unmatched.status,201,JSON.stringify(await unmatched.clone().json()));
 assert.equal((await singleBankCommand(req(owner,{...unmatch,key:randomUUID()}))).status,404,
  'a previously reversed match cannot be reversed a second time');
 const afterUnmatch=await (await listStatements(list('/api/bank/statements?accountReference=CI-bank',owner))).json() as {items:Array<{id:string;unmatchedCount:string|number}>};
 assert.equal(Number(afterUnmatch.items.find(x=>x.id===statement)?.unmatchedCount),1);
 const treasuryAfter=await (await listTreasury(list('/api/treasury',owner))).json() as {items:Array<{statementId:string;unmatchedCount:string|number}>};
 assert.equal(Number(treasuryAfter.items.find(x=>x.statementId===statement)?.unmatchedCount),1);

 const history=await GET(setTestIdentity(new Request('http://localhost/api/bank/reconciliation-batches?statementId='+statement),owner));
 assert.equal(history.status,200);
 assert.equal(((await history.json()) as {items:unknown[]}).items.length,1);
});
