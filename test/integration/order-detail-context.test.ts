import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { closeDatabase } from '../../db/raw';
import { GET } from '../../app/api/orders/[id]/route';
import { setTestIdentity } from '../../lib/api/test-identity.mjs';

if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL)
  throw Error('NO-GO: order context requires isolated test database');
const url = new URL(process.env.DATABASE_URL);
if (!['localhost','127.0.0.1'].includes(url.hostname) ||
    !['/cisne_test','/cisne_ci'].includes(url.pathname) || url.port !== '5432')
  throw Error('NO-GO: refusing data fixtures outside disposable CI PostgreSQL');

test('OS detail returns accurate history/relations exclusively to its actual owner', async () => {
  const db = new Pool({connectionString:process.env.DATABASE_URL,max:2});
  const actor=randomUUID(),foreign=randomUUID();
  const owned=randomUUID(),other=randomUUID(),ownerless=randomUUID();
  const clientId=randomUUID(),eventId=randomUUID(),measurementId=randomUUID();
  const invoiceId=randomUUID(),receivableId=randomUUID(),receiptId=randomUUID();
  const now=new Date().toISOString();
  const request=(id:string,who?:string) => {
    const req=new Request('http://localhost/api/orders/'+id);
    return who?setTestIdentity(req,who):req;
  };
  const detail=(id:string,who?:string) => GET(request(id,who),{params:Promise.resolve({id})});
  try {
    await db.query('INSERT INTO clients(id,owner_id,legal_name,created_at,updated_at) VALUES($1,$2,$3,$4,$4)',[clientId,actor,'CI order owner',now]);
    for (const [id,owner] of [[owned,actor],[other,foreign],[ownerless,null]]) {
      await db.query(`INSERT INTO service_orders
        (id,owner_id,client_id,title,client,category,description,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id,owner,clientId,'Owned context fixture','CI order owner','Serviços','Only test',now]);
    }
    await db.query('INSERT INTO order_events(id,order_id,command,version,created_at,actor_id) VALUES($1,$2,$3,1,$4,$5)',
      [eventId,owned,'create',now,actor]);
    await db.query('INSERT INTO measurements(id,order_id,description,amount,created_at) VALUES($1,$2,$3,$4,$5)',
      [measurementId,owned,'Test metric',10000,now]);
    await db.query('INSERT INTO invoices(id,measurement_id,order_id,amount,due_date,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      [invoiceId,measurementId,owned,10000,'2026-11-20',now]);
    await db.query('INSERT INTO receivables(id,invoice_id,amount,due_date,created_at) VALUES($1,$2,$3,$4,$5)',
      [receivableId,invoiceId,10000,'2026-11-20',now]);
    // Persistent receipt: the OS and Financeiro must show the SAME net
    // settlement facts, with no raw money floats in the response.
    await db.query(`INSERT INTO receivable_settlements
      (id,receivable_id,kind,amount,effective_date,reference,created_at,actor_id,request_hash,correlation_id)
      VALUES($1,$2,'receipt',$3,$4,$5,$6,$7,$8,$9)`,
      [receiptId,receivableId,2500,'2026-11-16','OS finance test',now,actor,'a'.repeat(64),randomUUID()]);

    const response=await detail(owned,actor);
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
    const payload=await response.json() as {order:{id:string;client_id:string|null;relations:{clientId:string|null;measurements:number;invoices:number;receivables:number};finance:{measuredScaled:string;invoicedScaled:string;receivableScaled:string;settledScaled:string;outstandingScaled:string;moneyScale:number;currency:string;bankBalanceAvailable:boolean};sublists:{history:{pageInfo:{total:number};items:Array<{id:string;label:string}>}}}};
    assert.equal(payload.order.id,owned);
    assert.equal(payload.order.client_id,clientId);
    assert.equal(payload.order.relations.clientId,clientId);
    assert.equal(payload.order.relations.measurements,1);
    assert.equal(payload.order.relations.invoices,1);
    assert.equal(payload.order.relations.receivables,1);
    assert.deepEqual({
      measured:payload.order.finance.measuredScaled,
      invoiced:payload.order.finance.invoicedScaled,
      principal:payload.order.finance.receivableScaled,
      settled:payload.order.finance.settledScaled,
      outstanding:payload.order.finance.outstandingScaled,
    },{measured:'10000',invoiced:'10000',principal:'10000',settled:'2500',outstanding:'7500'});
    assert.equal(payload.order.finance.moneyScale,4);
    assert.equal(payload.order.finance.currency,'BRL');
    assert.equal(payload.order.finance.bankBalanceAvailable,false);
    const foreignResponse=await detail(other,foreign);
    assert.equal(foreignResponse.status,200);
    const foreignPayload=await foreignResponse.json() as {order:{finance:{receivableScaled:string;outstandingScaled:string}}};
    assert.equal(foreignPayload.order.finance.receivableScaled,'0');
    assert.equal(foreignPayload.order.finance.outstandingScaled,'0');
    assert.equal(payload.order.sublists.history.pageInfo.total,1);
    assert.equal(payload.order.sublists.history.items[0].label,'OS cadastrada');
    assert.equal(payload.order.sublists.history.items[0].id,eventId);

    assert.equal((await detail(owned,foreign)).status,404);
    assert.equal((await detail(other,actor)).status,404);
    assert.equal((await detail(ownerless,actor)).status,404);
    assert.equal((await detail(owned)).status,401);
    assert.equal((await detail('not-a-uuid',actor)).status,400);
  } finally {
    await db.query('DELETE FROM receivable_settlements WHERE id=$1',[receiptId]);
    await db.query('DELETE FROM receivables WHERE id=$1',[receivableId]);
    await db.query('DELETE FROM invoices WHERE id=$1',[invoiceId]);
    await db.query('DELETE FROM measurements WHERE id=$1',[measurementId]);
    await db.query('DELETE FROM order_events WHERE id=$1',[eventId]);
    await db.query('DELETE FROM service_orders WHERE id=ANY($1::text[])',[[owned,other,ownerless]]);
    await db.query('DELETE FROM clients WHERE id=$1',[clientId]);
    await db.end();
    // The route creates a shared server Pool; close it in this disposable
    // test worker so node --test can exit without dangling PG sockets.
    await closeDatabase();
  }
});
