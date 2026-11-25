import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {closeDatabase} from '../../db/raw';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {GET as reconciliation} from '../../app/api/accounting/reconciliation/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)throw Error('Isolated PostgreSQL required');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3});
const owners=[randomUUID(),randomUUID()];
const orderIds=[randomUUID(),randomUUID()],measurementIds=[randomUUID(),randomUUID()],invoiceIds=[randomUUID(),randomUUID()];
const receivableId=randomUUID();
const url='http://localhost/api/accounting/reconciliation';
const request=(actor:string)=>setTestIdentity(new Request(url),actor);
before(async()=>{
  for(let i=0;i<2;i++){
    const now=new Date().toISOString();
    await pool.query(
      "INSERT INTO service_orders(id,owner_id,title,client,category,description,created_at,status) VALUES($1,$2,'CI order','CI client','Service','CI', $3,'completed')",
      [orderIds[i],owners[i],now],
    );
    await pool.query(
      "INSERT INTO measurements(id,order_id,description,amount,status,created_at) VALUES($1,$2,'CI measurement',$3,'approved',$4)",
      [measurementIds[i],orderIds[i],i===0?125000:91000,now],
    );
    await pool.query(
      'INSERT INTO invoices(id,measurement_id,order_id,amount,due_date,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      [invoiceIds[i],measurementIds[i],orderIds[i],i===0?125000:91000,'2027-02-01',now],
    );
  }
  await pool.query(
    'INSERT INTO receivables(id,invoice_id,amount,due_date,created_at) VALUES($1,$2,$3,$4,$5)',
    [receivableId,invoiceIds[0],125000,'2027-02-01',new Date().toISOString()],
  );
});
after(async()=>{
  await pool.query('DELETE FROM receivables WHERE id=$1',[receivableId]);
  await pool.query('DELETE FROM invoices WHERE id=ANY($1::text[])',[invoiceIds]);
  await pool.query('DELETE FROM measurements WHERE id=ANY($1::text[])',[measurementIds]);
  await pool.query('DELETE FROM service_orders WHERE id=ANY($1::text[])',[orderIds]);
  await closeDatabase();await pool.end();
});
test('reconciliation does not invent accounting links and isolates invoice ownership',async()=>{
  assert.equal((await reconciliation(new Request(url))).status,401);
  const forged=await reconciliation(new Request(url,{headers:{'oai-authenticated-user-id':owners[0]}}));
  assert.equal(forged.status,401);
  const a=await reconciliation(request(owners[0]));
  assert.equal(a.status,200);
  const body=await a.json() as {summary:{invoiceCount:number;withoutVerifiedPostingCount:number;withoutVerifiedPostingAmountScaled:string;missingReceivableCount:number};accountingLinkage:{status:string};items:Array<{invoiceId:string;receivableId:string|null}>};
  assert.equal(body.accountingLinkage.status,'NOT_SUPPORTED');
  assert.deepEqual(body.summary,{invoiceCount:1,withoutVerifiedPostingCount:1,withoutVerifiedPostingAmountScaled:'125000',missingReceivableCount:0,standaloneJournalCount:0});
  assert.deepEqual(body.items.map(x=>x.invoiceId),[invoiceIds[0]]);
  const b=await reconciliation(request(owners[1]));
  assert.equal(b.status,200);
  const foreign=await b.json() as typeof body;
  assert.equal(foreign.summary.invoiceCount,1);
  assert.equal(foreign.summary.missingReceivableCount,1);
  assert.deepEqual(foreign.items.map(x=>x.invoiceId),[invoiceIds[1]]);
});
