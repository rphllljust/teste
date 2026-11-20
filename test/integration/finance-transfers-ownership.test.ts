import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {closeDatabase} from '../../db/raw';
import {POST as createTransfer} from '../../app/api/finance/transfers/route';
import {POST as reverseTransfer} from '../../app/api/finance/transfers/[id]/reverse/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
 throw new Error('NO-GO: transfer ownership tests require isolated PostgreSQL');
const dbUrl=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(dbUrl.hostname)||
   !['/cisne_test','/cisne_ci'].includes(dbUrl.pathname)||dbUrl.port!=='5432')
 throw new Error('NO-GO: refusing transfer tests outside disposable CI database');

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});
const actor=randomUUID(),stranger=randomUUID(),id=randomUUID();
function req(path:string,actorId:string,payload:unknown){
 return setTestIdentity(new Request('http://localhost'+path,{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),
 }),actorId);
}
const payload={id,fromAccountReference:'CAIXA-CI-01',toAccountReference:'BANCO-CI-02',
 amount:'25,00',effectiveDate:'2026-11-16',reference:'Transferência isolada CI'};
const route=(id:string)=>({params:Promise.resolve({id})});
const reversal=(key:string)=>({commandKey:key,reference:'Reversão isolada CI'});

after(async()=>{
 try{
  await pool.query("DELETE FROM finance_audit_events WHERE actor_id=$1 OR (entity_id=$2 AND entity_type IN ('cash_transfer','cash_transfer_reversal'))",[actor,id]);
  await pool.query('DELETE FROM cash_transfers WHERE id=$1',[id]);
 }finally{await closeDatabase();await pool.end();}
});

test('cash transfer never grants cross-owner replay, reversal, or audit reuse',async()=>{
 const created=await createTransfer(req('/api/finance/transfers',actor,payload));
 assert.equal(created.status,201,JSON.stringify(await created.clone().json()));
 const row=await pool.query('SELECT actor_id,status,amount FROM cash_transfers WHERE id=$1',[id]);
 assert.deepEqual(row.rows[0],{actor_id:actor,status:'posted',amount:250000});

 // The UUID is known to the other owner, but it never grants read or write access.
 const foreignReplay=await createTransfer(req('/api/finance/transfers',stranger,payload));
 assert.equal(foreignReplay.status,409);
 const ownReplay=await createTransfer(req('/api/finance/transfers',actor,payload));
 assert.equal(ownReplay.status,200);

 const key=randomUUID();
 const unauthorized=await reverseTransfer(
   req('/api/finance/transfers/'+id+'/reverse',stranger,reversal(key)),route(id));
 assert.equal(unauthorized.status,404);
 const stillPosted=await pool.query('SELECT status FROM cash_transfers WHERE id=$1',[id]);
 assert.equal(stillPosted.rows[0].status,'posted');
 const ownerReversal=await reverseTransfer(
   req('/api/finance/transfers/'+id+'/reverse',actor,reversal(key)),route(id));
 assert.equal(ownerReversal.status,201);
 const idempotent=await reverseTransfer(
   req('/api/finance/transfers/'+id+'/reverse',actor,reversal(key)),route(id));
 assert.equal(idempotent.status,200);
 const final=await pool.query('SELECT actor_id,status FROM cash_transfers WHERE id=$1',[id]);
 assert.deepEqual(final.rows[0],{actor_id:actor,status:'reversed'});
 const audit=await pool.query(
   "SELECT actor_id,action FROM finance_audit_events WHERE entity_id=$1 AND entity_type='cash_transfer_reversal'",[id]);
 assert.equal(audit.rows.length,1);
 assert.deepEqual(audit.rows[0],{actor_id:actor,action:'transfer_reversed'});
});
