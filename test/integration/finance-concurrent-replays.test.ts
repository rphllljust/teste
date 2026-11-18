import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {closeDatabase} from '../../db/raw';
import {POST as receipt} from '../../app/api/finance/receivables/settlements/route';
import {POST as receiptReverse} from '../../app/api/finance/receivables/settlements/[id]/reverse/route';
import {POST as payablePayment} from '../../app/api/finance/payables/payments/route';
import {POST as paymentReverse} from '../../app/api/finance/payables/payments/[id]/reverse/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
  throw Error('FINANCE_REPLAY_NO_GO: disposable test PostgreSQL required');
const u=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(u.hostname)||
  !['/cisne_test','/cisne_ci'].includes(u.pathname)||u.port!=='5432')
  throw Error('FINANCE_REPLAY_NO_GO: refusing staging/production DB');
const owner=randomUUID(),orderId=randomUUID(),measurementId=randomUUID(),
  invoiceId=randomUUID(),receivableId=randomUUID(),payableId=randomUUID();
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:5});
function req(path:string,body:unknown){
  return setTestIdentity(new Request('http://localhost'+path,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
  }),owner);
}
async function checkResponses(responses:Response[],label:string){
  const seen=responses.map(x=>x.status).sort((a,b)=>a-b);
  assert.deepEqual(seen,[200,201],label+' must return one 201 and one idempotent 200');
  const replay=responses.find(x=>x.status===200)!;
  assert.equal((await replay.json() as {replayed:boolean}).replayed,true,
    label+' retry must be flagged replayed');
}
before(async()=>{
  const now=new Date().toISOString();
  await pool.query(
    "INSERT INTO service_orders(id,owner_id,title,client,category,description,status,created_at) VALUES($1,$2,'Concorrência financeira','Cliente CI','Serviços','Idempotência','completed',$3)",
    [orderId,owner,now],
  );
  await pool.query(
    "INSERT INTO measurements(id,order_id,description,amount,status,created_at) VALUES($1,$2,'Medição CI',10000,'billed',$3)",
    [measurementId,orderId,now],
  );
  await pool.query(
    "INSERT INTO invoices(id,measurement_id,order_id,amount,due_date,created_at) VALUES($1,$2,$3,10000,'2026-12-31',$4)",
    [invoiceId,measurementId,orderId,now],
  );
  await pool.query(
    "INSERT INTO receivables(id,invoice_id,amount,due_date,created_at) VALUES($1,$2,10000,'2026-12-31',$3)",
    [receivableId,invoiceId,now],
  );
  await pool.query(
    "INSERT INTO payables(id,supplier,source_reference,description,amount,due_date,created_at,actor_id,request_hash,correlation_id) VALUES($1,'Fornecedor CI','CI-REPLAY','Pagamento concorrente CI',10000,'2026-12-31',$2,$3,$4,$5)",
    [payableId,now,owner,'d'.repeat(64),randomUUID()],
  );
});
after(async()=>{
  try{
    await pool.query('DELETE FROM finance_audit_events WHERE actor_id=$1',[owner]);
    await pool.query('DELETE FROM receivable_settlements WHERE receivable_id=$1',[receivableId]);
    await pool.query('DELETE FROM payable_payments WHERE payable_id=$1',[payableId]);
    await pool.query('DELETE FROM payables WHERE id=$1',[payableId]);
    await pool.query('DELETE FROM receivables WHERE id=$1',[receivableId]);
    await pool.query('DELETE FROM invoices WHERE id=$1',[invoiceId]);
    await pool.query('DELETE FROM measurements WHERE id=$1',[measurementId]);
    await pool.query('DELETE FROM service_orders WHERE id=$1',[orderId]);
  }finally{await closeDatabase();await pool.end();}
});

test('simultaneous identical receivable receipt key must be a replay, never 409/503',async()=>{
  const key=randomUUID();
  const body={receivableId,amount:'2500',effectiveDate:'2026-11-18',
    reference:'Recebimento sintético idempotente',commandKey:key};
  await checkResponses(await Promise.all(Array.from({length:2},()=>
    receipt(req('/api/finance/receivables/settlements',body)))),
    'receivable receipt');
  const fact=await pool.query(
    "SELECT COUNT(*)::int AS n,COALESCE(SUM(amount),0)::bigint AS amount FROM receivable_settlements WHERE receivable_id=$1 AND kind='receipt'",
    [receivableId],
  );
  assert.equal(fact.rows[0].n,1);assert.equal(String(fact.rows[0].amount),'2500');
});

test('simultaneous identical receivable reversal is one fact and one replay',async()=>{
  const initial=(await pool.query(
    "SELECT id FROM receivable_settlements WHERE receivable_id=$1 AND kind='receipt'",
    [receivableId],
  )).rows[0].id as string;
  const key=randomUUID(),body={commandKey:key,effectiveDate:'2026-11-19',
    reference:'Reversão sintética idempotente'};
  await checkResponses(await Promise.all(Array.from({length:2},()=>
    receiptReverse(req('/api/finance/receivables/settlements/'+initial+'/reverse',body),
      {params:Promise.resolve({id:initial})}))),
    'receivable reversal');
  assert.equal((await pool.query(
    'SELECT COUNT(*)::int AS n FROM receivable_settlements WHERE reverses_id=$1',[initial],
  )).rows[0].n,1);
});

test('simultaneous identical payable payment is one fact and one replay',async()=>{
  const key=randomUUID(),body={payableId,amount:'2500',effectiveDate:'2026-11-18',
    reference:'Pagamento sintético idempotente',commandKey:key};
  await checkResponses(await Promise.all(Array.from({length:2},()=>
    payablePayment(req('/api/finance/payables/payments',body)))),
    'payable payment');
  const fact=await pool.query(
    "SELECT COUNT(*)::int AS n,COALESCE(SUM(amount),0)::bigint AS amount FROM payable_payments WHERE payable_id=$1 AND kind='payment'",
    [payableId],
  );
  assert.equal(fact.rows[0].n,1);assert.equal(String(fact.rows[0].amount),'2500');
});

test('simultaneous identical payable reversal is one fact and one replay',async()=>{
  const initial=(await pool.query(
    "SELECT id FROM payable_payments WHERE payable_id=$1 AND kind='payment'",
    [payableId],
  )).rows[0].id as string;
  const key=randomUUID(),body={commandKey:key,effectiveDate:'2026-11-19',
    reference:'Estorno pagamento CI'};
  await checkResponses(await Promise.all(Array.from({length:2},()=>
    paymentReverse(req('/api/finance/payables/payments/'+initial+'/reverse',body),
      {params:Promise.resolve({id:initial})}))),
    'payable reversal');
  assert.equal((await pool.query(
    'SELECT COUNT(*)::int AS n FROM payable_payments WHERE reverses_id=$1',[initial],
  )).rows[0].n,1);
});
