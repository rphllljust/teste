import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {closeDatabase} from '../../db/raw';
import {POST as orderCommand} from '../../app/api/commands/route';
import {POST as settle} from '../../app/api/finance/receivables/settlements/route';
import {POST as pay} from '../../app/api/finance/payables/payments/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
  throw Error('CONCURRENCY_NO_GO: disposable PostgreSQL required');
const u=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(u.hostname)||
  !['/cisne_test','/cisne_ci'].includes(u.pathname)||u.port!=='5432')
  throw Error('CONCURRENCY_NO_GO: non-disposable database rejected');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:5});
const owner=randomUUID(),orderId=randomUUID(),completeId=randomUUID();
const measurementId=randomUUID(),payableId=randomUUID();
let invoiceId='',receivableId='';
function request(path:string,data:unknown){
  return setTestIdentity(new Request('http://localhost'+path,{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify(data),
  }),owner);
}
async function postCommand(id:string,version:number,command:string,extra:object={}){
  return orderCommand(request('/api/commands',{
    id,version,key:randomUUID(),command,...extra,
  }));
}
async function postSettlement(amount:string){
  return settle(request('/api/finance/receivables/settlements',{
    receivableId,amount,effectiveDate:'2026-11-18',reference:'CI racing settlement',
    commandKey:randomUUID(),
  }));
}
async function postPayable(amount:string){
  return pay(request('/api/finance/payables/payments',{
    payableId,amount,effectiveDate:'2026-11-18',reference:'CI racing payable',
    commandKey:randomUUID(),
  }));
}
async function expectOne(responses:Response[],expected:number[],name:string){
  const statuses=responses.map(x=>x.status).sort((a,b)=>a-b);
  assert.deepEqual(statuses,expected,name+' must serialize business races: '+statuses);
}
after(async()=>{
  try{
    await pool.query('DELETE FROM finance_audit_events WHERE actor_id=$1',[owner]);
    if(receivableId){
      await pool.query('DELETE FROM receivable_settlements WHERE receivable_id=$1',[receivableId]);
      await pool.query('DELETE FROM receivables WHERE id=$1',[receivableId]);
    }
    await pool.query('DELETE FROM payable_payments WHERE payable_id=$1',[payableId]);
    await pool.query('DELETE FROM payables WHERE id=$1',[payableId]);
    if(invoiceId)await pool.query('DELETE FROM invoices WHERE id=$1',[invoiceId]);
    await pool.query('DELETE FROM measurements WHERE id=$1',[measurementId]);
    await pool.query('DELETE FROM order_events WHERE order_id=ANY($1::text[])',[[orderId,completeId]]);
    await pool.query('DELETE FROM service_orders WHERE id=ANY($1::text[])',[[orderId,completeId]]);
  }finally{await closeDatabase();await pool.end();}
});

test('two invoice commands on the same approved measurement create exactly one invoice and title',async()=>{
  const now=new Date().toISOString();
  await pool.query(
    "INSERT INTO service_orders(id,owner_id,title,client,category,description,status,version,created_at) VALUES($1,$2,'CI faturamento','Empresa CI','Serviços','Concorrência','completed',4,$3)",
    [orderId,owner,now],
  );
  await pool.query(
    "INSERT INTO measurements(id,order_id,description,amount,status,version,created_at) VALUES($1,$2,'Medição CI',100000,'approved',2,$3)",
    [measurementId,orderId,now],
  );
  const calls=await Promise.all(Array.from({length:2},()=>
    postCommand(measurementId,2,'invoice',{dueDate:'2026-12-31'})));
  await expectOne(calls,[201,409],'concurrent invoicing');
  const winner=calls.find(r=>r.status===201);
  const body=await winner!.json() as {resource:{id:string;receivableId:string}};
  invoiceId=body.resource.id;receivableId=body.resource.receivableId;
  const facts=await pool.query(
    'SELECT (SELECT COUNT(*)::int FROM invoices WHERE measurement_id=$1) AS invoices, (SELECT COUNT(*)::int FROM receivables r JOIN invoices i ON i.id=r.invoice_id WHERE i.measurement_id=$1) AS receivables, (SELECT status FROM measurements WHERE id=$1) AS measurement',
    [measurementId],
  );
  assert.deepEqual(facts.rows[0],{invoices:1,receivables:1,measurement:'billed'});
});

test('ten simultaneous receivable settlements cannot overpay the same title',async()=>{
  assert.ok(receivableId,'invoice fixture must finish first');
  const calls=await Promise.all(Array.from({length:10},()=>postSettlement('20000')));
  const accepted=calls.filter(r=>r.status===201).length;
  assert.equal(accepted,5,'Only five 20k receipts may settle a 100k receivable');
  assert.ok(calls.every(r=>[201,409].includes(r.status)));
  const facts=await pool.query(
    "SELECT COALESCE(SUM(amount),0)::bigint AS paid,COUNT(*)::int AS receipts FROM receivable_settlements WHERE receivable_id=$1 AND kind='receipt'",
    [receivableId],
  );
  assert.equal(String(facts.rows[0].paid),'100000');
  assert.equal(facts.rows[0].receipts,5);
});

test('ten simultaneous payable payments cannot overpay the same obligation',async()=>{
  const now=new Date().toISOString();
  await pool.query(
    "INSERT INTO payables(id,supplier,source_reference,description,amount,due_date,created_at,actor_id,request_hash,correlation_id) VALUES($1,'CI fornecedor','CI-PR', 'CI obligation',100000,'2026-12-31',$2,$3,$4,$5)",
    [payableId,now,owner,'c'.repeat(64),randomUUID()],
  );
  const calls=await Promise.all(Array.from({length:10},()=>postPayable('20000')));
  assert.equal(calls.filter(r=>r.status===201).length,5,
    'Only five 20k payments may settle a 100k payable');
  assert.ok(calls.every(r=>[201,409].includes(r.status)));
  const facts=await pool.query(
    "SELECT COALESCE(SUM(amount),0)::bigint AS paid,COUNT(*)::int AS payments FROM payable_payments WHERE payable_id=$1 AND kind='payment'",
    [payableId],
  );
  assert.equal(String(facts.rows[0].paid),'100000');
  assert.equal(facts.rows[0].payments,5);
});

test('two simultaneous OS completions create one terminal transition',async()=>{
  await pool.query(
    "INSERT INTO service_orders(id,owner_id,title,client,category,description,status,version,created_at) VALUES($1,$2,'CI conclusão','Cliente CI','Serviços','Concorrência','executing',3,now())",
    [completeId,owner],
  );
  const responses=await Promise.all(Array.from({length:2},()=>
    postCommand(completeId,3,'complete')));
  await expectOne(responses,[201,409],'concurrent completion');
  const facts=await pool.query(
    "SELECT status,version,(SELECT COUNT(*)::int FROM order_events WHERE order_id=$1 AND command='complete') AS completions FROM service_orders WHERE id=$1",
    [completeId],
  );
  assert.deepEqual(facts.rows[0],{status:'completed',version:4,completions:1});
});
