import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {closeDatabase} from '../../db/raw';
import {POST as settle} from '../../app/api/finance/receivables/settlements/route';
import {GET as pending,POST as regularize} from '../../app/api/accounting/pending/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
  throw new Error('Accounting regularization requires isolated PostgreSQL');

const owner=randomUUID(),orderId=randomUUID(),measurementId=randomUUID(),invoiceId=randomUUID(),receivableId=randomUUID();
const debitId=randomUUID(),creditId=randomUUID(),ruleId=randomUUID(),settlementId=randomUUID();
const pool=new Pool({connectionString:process.env.DATABASE_URL});

function request(path:string,body?:unknown){
  return setTestIdentity(new Request('http://localhost'+path,{
    method:body===undefined?'GET':'POST',
    headers:body===undefined?{}:{'content-type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  }),owner);
}

before(async()=>{
  const now=new Date().toISOString();
  await pool.query("INSERT INTO service_orders(id,owner_id,title,client,category,description,status,created_at) VALUES($1,$2,'Regularização CI','Cliente CI','Serviços','Evento pendente','completed',$3)",[orderId,owner,now]);
  await pool.query("INSERT INTO measurements(id,order_id,description,amount,status,created_at) VALUES($1,$2,'Medição pendente',10000,'billed',$3)",[measurementId,orderId,now]);
  await pool.query("INSERT INTO invoices(id,measurement_id,order_id,amount,due_date,created_at) VALUES($1,$2,$3,10000,'2026-12-31',$4)",[invoiceId,measurementId,orderId,now]);
  await pool.query("INSERT INTO receivables(id,invoice_id,amount,due_date,created_at) VALUES($1,$2,10000,'2026-12-31',$3)",[receivableId,invoiceId,now]);
});

after(async()=>{
  try{
    await pool.query('DELETE FROM journal_lines WHERE entry_id IN (SELECT id FROM journal_entries WHERE actor_id=$1)',[owner]);
    await pool.query('DELETE FROM journal_entries WHERE actor_id=$1',[owner]);
    await pool.query('DELETE FROM accounting_event_rules WHERE actor_id=$1',[owner]);
    await pool.query('DELETE FROM chart_accounts WHERE actor_id=$1',[owner]);
    await pool.query('DELETE FROM receivable_settlements WHERE receivable_id=$1',[receivableId]);
    await pool.query('DELETE FROM receivables WHERE id=$1',[receivableId]);
    await pool.query('DELETE FROM invoices WHERE id=$1',[invoiceId]);
    await pool.query('DELETE FROM measurements WHERE id=$1',[measurementId]);
    await pool.query('DELETE FROM service_orders WHERE id=$1',[orderId]);
  }finally{await closeDatabase();await pool.end();}
});

test('regularizes a persisted receipt after the accounting rule becomes valid',async()=>{
  const initial=await settle(request('/api/finance/receivables/settlements',{
    receivableId,amount:'10000',effectiveDate:'2026-11-18',reference:'Receipt pending CI',commandKey:settlementId,
  }));
  assert.equal(initial.status,201);
  const initialBody=await initial.json() as {resource:{accounting:{posted:boolean;reason:string}}};
  assert.equal(initialBody.resource.accounting.posted,false);
  assert.equal(initialBody.resource.accounting.reason,'ACCOUNTING_RULE_NOT_CONFIGURED');

  const now=new Date().toISOString();
  await pool.query("INSERT INTO chart_accounts(id,code,name,type,active,created_at,actor_id,request_hash) VALUES($1,$2,'Caixa regularização','asset',1,$3,$4,$5),($6,$7,'Receita regularização','revenue',1,$3,$4,$5)",
    [debitId,'REG-'+randomUUID().slice(0,8),now,owner,'a'.repeat(64),creditId,'REG-'+randomUUID().slice(0,8)]);
  await pool.query("INSERT INTO accounting_event_rules(id,actor_id,event_type,debit_account_id,credit_account_id,active,created_at,request_hash,correlation_id) VALUES($1,$2,'receivable_settlement',$3,$4,true,$5,$6,$7)",
    [ruleId,owner,debitId,creditId,now,'b'.repeat(64),randomUUID()]);

  const pendingResponse=await pending(request('/api/accounting/pending'));
  assert.equal(pendingResponse.status,200);
  const pendingBody=await pendingResponse.json() as {items:Array<{factType:string;factId:string}>};
  assert.deepEqual(pendingBody.items.map(item=>item.factId),[settlementId]);

  const commandKey=randomUUID();
  const first=await regularize(request('/api/accounting/pending',{
    factType:'receivableSettlement',settlementId,commandKey,
  }));
  assert.equal(first.status,201);
  const firstBody=await first.json() as {resource:{accounting:{posted:boolean;journalId:string}}};
  assert.equal(firstBody.resource.accounting.posted,true);

  const replay=await regularize(request('/api/accounting/pending',{
    factType:'receivableSettlement',settlementId,commandKey,
  }));
  assert.equal(replay.status,200);
  assert.equal((await replay.json() as {replayed:boolean}).replayed,true);

  const facts=await pool.query('SELECT COUNT(*)::int AS entries,(SELECT COUNT(*)::int FROM journal_lines WHERE entry_id=$1) AS lines,(SELECT COALESCE(SUM(debit),0)::bigint FROM journal_lines WHERE entry_id=$1) AS debit,(SELECT COALESCE(SUM(credit),0)::bigint FROM journal_lines WHERE entry_id=$1) AS credit FROM journal_entries WHERE id=$1',[firstBody.resource.accounting.journalId]);
  assert.deepEqual(facts.rows[0],{entries:1,lines:2,debit:'10000',credit:'10000'});
});
