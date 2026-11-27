import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {closeDatabase} from '../../db/raw';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {GET} from '../../app/api/orders/[id]/control/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
 throw Error('NO-GO: isolated PostgreSQL required for OS operational controls');
const url=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(url.hostname)||
 !['/cisne_ci','/cisne_test'].includes(url.pathname)||
 !['cisne_ci','cisne_test'].includes(url.username))
 throw Error('NO-GO: refusing non-disposable service order fixtures');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});
const owner=randomUUID(),foreign=randomUUID(),order=randomUUID(),
 otherOrder=randomUUID(),ownerlessOrder=randomUUID(),measurement=randomUUID(),
 invoice=randomUUID(),now=new Date().toISOString();
const get=(id:string,actor?:string)=>{
 const request=new Request('http://localhost/api/orders/'+id+'/control');
 return GET(actor?setTestIdentity(request,actor):request,{params:Promise.resolve({id})});
};
type Response={
 order:{id:string;version:number;status:string};
 counts:{activeExecutions:number;measurements:number;invoices:number};
 financial:{billedScaled:string;openReceivableScaled:string;attributedCostScaled:string};
 alerts:Array<{code:string}>;
 evidence:{measurements:{approvedUnbilled:number};
  billing:{withoutReceivable:number;withoutVerifiedPosting:number}};
 consistency:string;
};
before(async()=>{
 for(const [id,actor] of [[order,owner],[otherOrder,foreign],[ownerlessOrder,null]]){
  await pool.query(`INSERT INTO service_orders
   (id,owner_id,title,client,category,description,due_date,status,created_at)
   VALUES($1,$2,'Control plane fixture','Test Client','Serviços','Test only','2026-01-01','completed',$3)`,
   [id,actor,now]);
 }
});
after(async()=>{
 try{
  await pool.query('DELETE FROM invoices WHERE id=$1',[invoice]);
  await pool.query('DELETE FROM measurements WHERE id=$1',[measurement]);
  await pool.query('DELETE FROM service_orders WHERE id=ANY($1::text[])',[[order,otherOrder,ownerlessOrder]]);
 }finally{await pool.end();await closeDatabase();}
});
test('isolates OS and all related finances to authenticated owner; denies ownerless legacy records',async()=>{
 assert.equal((await get(order)).status,401);
 assert.equal((await get(order,foreign)).status,404);
 assert.equal((await get(otherOrder,owner)).status,404);
 assert.equal((await get(ownerlessOrder,owner)).status,404);
 assert.equal((await get('bad-id',owner)).status,400);
 const ok=await get(order,owner);
 assert.equal(ok.status,200);
 assert.equal(ok.headers.get('cache-control'),'no-store');
 const payload=await ok.json() as Response;
 assert.equal(payload.order.id,order);
 assert.equal(payload.consistency,'REPEATABLE READ READ ONLY');
 assert.equal(payload.counts.activeExecutions,0);
 assert.equal(payload.financial.billedScaled,'0');
 assert.ok(payload.alerts.some(x=>x.code==='COMPLETED_WITHOUT_EXECUTION'));
});
test('measurement approval and invoices drive genuine downstream exceptions',async()=>{
 await pool.query(`INSERT INTO measurements
  (id,order_id,description,amount,status,created_at)
  VALUES($1,$2,'Approved measurement',125000,'approved',$3)`,[measurement,order,now]);
 const beforeInvoice=await(await get(order,owner)).json() as Response;
 assert.equal(beforeInvoice.evidence.measurements.approvedUnbilled,1);
 assert.ok(beforeInvoice.alerts.some(a=>a.code==='APPROVED_UNBILLED'));
 await pool.query(`INSERT INTO invoices
  (id,measurement_id,order_id,amount,due_date,created_at)
  VALUES($1,$2,$3,125000,'2029-12-01',$4)`,[invoice,measurement,order,now]);
 const afterInvoice=await(await get(order,owner)).json() as Response;
 assert.equal(afterInvoice.evidence.measurements.approvedUnbilled,0);
 assert.equal(afterInvoice.evidence.billing.withoutReceivable,1);
 assert.equal(afterInvoice.evidence.billing.withoutVerifiedPosting,1);
 assert.equal(afterInvoice.financial.billedScaled,'125000');
 assert.equal(afterInvoice.financial.openReceivableScaled,'125000');
 assert.equal(afterInvoice.financial.attributedCostScaled,'0');
 assert.ok(afterInvoice.alerts.some(x=>x.code==='INVOICE_WITHOUT_RECEIVABLE'));
});
