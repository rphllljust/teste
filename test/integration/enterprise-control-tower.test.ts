import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {GET} from '../../app/api/enterprise/control-tower/route';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {closeDatabase} from '../../db/raw';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
 throw Error('NO-GO: enterprise control tower tests require isolated PostgreSQL');
const url=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(url.hostname)||
 !['/cisne_test','/cisne_ci'].includes(url.pathname)||url.port!=='5432')
 throw Error('NO-GO: refusing enterprise tests outside disposable PostgreSQL');

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});
const owner=randomUUID(),other=randomUUID(),owners=[owner,other];
const cases=owners.map(actor=>({
 actor,lateOrder:randomUUID(),completeOrder:randomUUID(),billedOrder:randomUUID(),
 measurement:randomUUID(),invoice:randomUUID(),receivable:randomUUID(),
 receipt:randomUUID(),payable:randomUUID(),payment:randomUUID(),
 supplier:randomUUID(),item:randomUUID(),movement:randomUUID(),
 reservation:randomUUID(),purchase:randomUUID(),approval:randomUUID(),
}));
const extraOrders=Array.from({length:8},()=>randomUUID());
const stamp='2026-11-20T12:00:00.000Z';
function request(actor:string|undefined,asOf='2026-11-20'){
 const req=new Request('http://localhost/api/enterprise/control-tower?asOf='+asOf);
 return actor?setTestIdentity(req,actor):req;
}
async function seed(c:typeof cases[number]){
 const actor=c.actor;
 await pool.query('INSERT INTO service_orders(id,owner_id,title,client,category,description,due_date,created_at,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
  [c.lateOrder,actor,'Late work '+actor,'CI','Serviços','CI','2026-11-10',stamp,'authorized']);
 for(const id of [c.completeOrder,c.billedOrder])
  await pool.query('INSERT INTO service_orders(id,owner_id,title,client,category,description,created_at,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
   [id,actor,'Completed '+id,'CI','Serviços','CI',stamp,'completed']);
 await pool.query('INSERT INTO measurements(id,order_id,description,amount,status,created_at) VALUES($1,$2,$3,$4,$5,$6)',
  [c.measurement,c.billedOrder,'Approved CI',10000,'approved',stamp]);
 await pool.query('INSERT INTO invoices(id,measurement_id,order_id,amount,due_date,created_at) VALUES($1,$2,$3,$4,$5,$6)',
  [c.invoice,c.measurement,c.billedOrder,10000,'2026-11-10',stamp]);
 await pool.query('INSERT INTO receivables(id,invoice_id,amount,due_date,created_at) VALUES($1,$2,$3,$4,$5)',
  [c.receivable,c.invoice,10000,'2026-11-10',stamp]);
 await pool.query('INSERT INTO receivable_settlements(id,receivable_id,kind,amount,effective_date,reference,created_at,actor_id,request_hash,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
  [c.receipt,c.receivable,'receipt',4000,'2026-11-11','CI partial',stamp,actor,randomUUID(),randomUUID()]);
 await pool.query('INSERT INTO payables(id,supplier,source_reference,description,amount,due_date,created_at,actor_id,request_hash,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
  [c.payable,'Supplier '+actor,'CI','CI',20000,'2026-11-10',stamp,actor,randomUUID(),randomUUID()]);
 await pool.query('INSERT INTO payable_payments(id,payable_id,kind,amount,effective_date,reference,created_at,actor_id,request_hash,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
  [c.payment,c.payable,'payment',5000,'2026-11-11','CI partial',stamp,actor,randomUUID(),randomUUID()]);
 await pool.query('INSERT INTO suppliers(id,owner_id,legal_name,document,created_at,updated_at,request_hash) VALUES($1,$2,$3,$4,$5,$5,$6)',
  [c.supplier,actor,'Supplier '+actor,'CI-'+actor,stamp,randomUUID()]);
 await pool.query('INSERT INTO inventory_items(id,owner_id,sku,name,unit,minimum,created_at,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
  [c.item,actor,'SKU-'+actor,'Stock '+actor,'un',15000,stamp,randomUUID()]);
 await pool.query('INSERT INTO inventory_movements(id,item_id,owner_id,delta,reference,created_at,request_hash,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
  [c.movement,c.item,actor,12000,'CI incoming',stamp,randomUUID(),randomUUID()]);
 await pool.query('INSERT INTO inventory_reservations(id,item_id,owner_id,source_document_type,source_document_id,source_reference,quantity,consumed_quantity,status,created_at,request_hash,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
  [c.reservation,c.item,actor,'service-order',c.lateOrder,'CI',4000,0,'reserved',stamp,randomUUID(),randomUUID()]);
 await pool.query('INSERT INTO supplier_purchase_orders(id,owner_id,supplier_id,item_id,reference,quantity,unit_price,total,expected_on,status,created_at,updated_at,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12)',
  [c.purchase,actor,c.supplier,c.item,'PO-'+actor,1000,1000,1000,'2026-11-10','approved',stamp,randomUUID()]);
 await pool.query('INSERT INTO workflow_approval_requests(id,owner_id,entity_type,entity_id,command,state,requested_by,approver_id,expected_version,payload,request_hash,correlation_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
  [c.approval,actor,'service_order',c.lateOrder,'authorize','pending',randomUUID(),actor,1,'{}',randomUUID(),randomUUID(),stamp]);
}
before(async()=>{
 for(const c of cases)await seed(c);
 for(const id of extraOrders)
  await pool.query('INSERT INTO service_orders(id,owner_id,title,client,category,description,due_date,created_at,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
   [id,owner,'Additional late CI','CI','Serviços','CI','2026-11-10',stamp,'authorized']);
});
after(async()=>{
 for(const c of cases){
  const actor=c.actor;
  await pool.query('DELETE FROM workflow_approval_requests WHERE owner_id=$1',[actor]);
  await pool.query('DELETE FROM supplier_purchase_orders WHERE owner_id=$1',[actor]);
  await pool.query('DELETE FROM inventory_reservations WHERE owner_id=$1',[actor]);
  await pool.query('DELETE FROM inventory_movements WHERE owner_id=$1',[actor]);
  await pool.query('DELETE FROM inventory_items WHERE owner_id=$1',[actor]);
  await pool.query('DELETE FROM suppliers WHERE owner_id=$1',[actor]);
  await pool.query('DELETE FROM payable_payments WHERE payable_id=$1',[c.payable]);
  await pool.query('DELETE FROM payables WHERE id=$1',[c.payable]);
  await pool.query('DELETE FROM receivable_settlements WHERE receivable_id=$1',[c.receivable]);
  await pool.query('DELETE FROM receivables WHERE id=$1',[c.receivable]);
  await pool.query('DELETE FROM invoices WHERE id=$1',[c.invoice]);
  await pool.query('DELETE FROM measurements WHERE id=$1',[c.measurement]);
  await pool.query('DELETE FROM service_orders WHERE owner_id=$1',[actor]);
 }
 await closeDatabase();
 await pool.end();
});
test('seven persisted lanes remain owner-scoped with full counts and partial monetary ledgers',async()=>{
 const response=await GET(request(owner));
 assert.equal(response.status,200,await response.clone().text());
 assert.equal(response.headers.get('Cache-Control'),'no-store');
 const data=await response.json() as {authority:string;sampleLimitPerLane:number;
  lanes:{id:string;count:number;totalAmountScaled:string|null;items:Array<{id:string;availableScaled:string|null;requiredScaled:string|null}>}[]};
 assert.equal(data.authority,'owner_scoped_persisted_postgresql.v1');
 assert.equal(data.sampleLimitPerLane,6);
 const lane=(id:string)=>{const found=data.lanes.find(l=>l.id===id);assert.ok(found,id);return found;};
 assert.equal(lane('lateOrders').count,9);
 assert.equal(lane('lateOrders').items.length,6,'sample limit does not truncate authoritative total');
 for(const id of ['unmeasuredOrders','overdueReceivables','overduePayables','latePurchases','stockShortage','myApprovals'])
  assert.equal(lane(id).count,1,id);
 assert.equal(lane('overdueReceivables').totalAmountScaled,'6000');
 assert.equal(lane('overduePayables').totalAmountScaled,'15000');
 assert.equal(lane('stockShortage').items[0].availableScaled,'8000');
 assert.equal(lane('stockShortage').items[0].requiredScaled,'15000');
 const forbidden=cases[1];
 assert.ok(data.lanes.every(l=>l.items.every(i=>!Object.values(forbidden).includes(i.id))),
  'Cross-owner IDs are never present in rendered exception samples');
});
test('dates, authorization and alternative owner are enforced by the database',async()=>{
 const today=await GET(request(other));
 assert.equal(today.status,200);
 const result=await today.json() as {lanes:{id:string;count:number;items:{id:string}[]}[]};
 const lane=(id:string)=>result.lanes.find(l=>l.id===id)!;
 assert.equal(lane('lateOrders').count,1);
 assert.equal(lane('overdueReceivables').items[0].id,cases[1].receivable);
 assert.equal(lane('overduePayables').items[0].id,cases[1].payable);
 assert.equal((await GET(request(owner,'2026-11-01'))).status,200);
 const early=await (await GET(request(owner,'2026-11-01'))).json() as {lanes:{id:string;count:number}[]};
 for(const id of ['lateOrders','overdueReceivables','overduePayables','latePurchases'])
  assert.equal(early.lanes.find(l=>l.id===id)?.count,0,id);
 assert.equal((await GET(request(undefined))).status,401);
 assert.equal((await GET(request(owner,'2026-02-30'))).status,400);
});
