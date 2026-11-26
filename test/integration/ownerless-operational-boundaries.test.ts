import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {closeDatabase} from '../../db/raw';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {GET as orders} from '../../app/api/orders/route';
import {GET as operations} from '../../app/api/enterprise/operations/route';
import {GET as linked} from '../../app/api/operation/route';
import {GET as linkedDetail} from '../../app/api/operation/[kind]/[id]/route';
import {GET as finance} from '../../app/api/finance/workspace/route';
import {GET as orderExecution,POST as reportExecution} from '../../app/api/orders/[id]/execution/route';
import {POST as orderCommand} from '../../app/api/commands/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
 throw Error('Ownerless security integration must use isolated disposable PostgreSQL');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3});
const actor=randomUUID(),legacyOrder=randomUUID(),ownedOrder=randomUUID();
const measurement=randomUUID(),invoice=randomUUID(),receivable=randomUUID();
const req=(path:string,body?:unknown)=>setTestIdentity(new Request('http://localhost'+path,{
 method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},
 ...(body===undefined?{}:{body:JSON.stringify(body)}),
}),actor);
const report=(version:number)=>({
 command:'report',key:randomUUID(),version,resourceKind:'labor',
 description:'Evidence test only',quantity:'1',unit:'h',
 resourceReference:'TEST-LABOR',effectiveDate:'2026-11-26',reference:'SECURITY-UAT',
});
before(async()=>{
 const now='2026-11-26T18:00:00Z';
 await pool.query(`INSERT INTO service_orders
  (id,owner_id,title,client,category,description,due_date,status,version,created_at)
  VALUES($1,NULL,'Ownerless CI record','Legacy sample','Serviços','Owner isolation probe','2099-01-01','executing',1,$3),
        ($2,$4,'Owned CI record','Owned sample','Serviços','Version probe','2099-01-01','executing',2,$3)`,
   [legacyOrder,ownedOrder,now,actor]);
 await pool.query(`INSERT INTO measurements(id,order_id,description,amount,status,version,created_at)
   VALUES($1,$2,'Legacy sample',10000,'approved',1,$3)`,[measurement,legacyOrder,now]);
 await pool.query(`INSERT INTO invoices(id,measurement_id,order_id,amount,due_date,created_at)
   VALUES($1,$2,$3,10000,'2099-01-01',$4)`,[invoice,measurement,legacyOrder,now]);
 await pool.query(`INSERT INTO receivables(id,invoice_id,amount,due_date,created_at)
   VALUES($1,$2,10000,'2099-01-01',$3)`,[receivable,invoice,now]);
});
after(async()=>{await closeDatabase();await pool.end();});
test('ownerless service order is hidden from lists and operational KPI, while owned record remains visible',async()=>{
 const orderResponse=await orders(req('/api/orders'));
 assert.equal(orderResponse.status,200);
 const orderData=await orderResponse.json() as {items:Array<{id:string}>;summary:{total:number}};
 assert.equal(orderData.items.some(row=>row.id===legacyOrder),false);
 assert.equal(orderData.items.some(row=>row.id===ownedOrder),true);
 assert.equal(orderData.summary.total,1);
 const report=await operations(req('/api/enterprise/operations?queue=all'));
 assert.equal(report.status,200);
 const values=await report.json() as {items:Array<{id:string}>;summary:{total:number}};
 assert.equal(values.summary.total,1);
 assert.equal(values.items.some(row=>row.id===legacyOrder),false);
});
test('legacy measurement, invoice and finance figures cannot be read by an unrelated actor',async()=>{
 const list=await linked(req('/api/operation?kind=measurements'));
 assert.equal(list.status,200);
 const data=await list.json() as {pageInfo:{sourceTotal:number}};
 assert.equal(data.pageInfo.sourceTotal,0);
 const detail=await linkedDetail(req('/api/operation/measurements/'+measurement),{
   params:Promise.resolve({kind:'measurements',id:measurement}),
 });
 assert.equal(detail.status,404);
 const financial=await finance(req('/api/finance/workspace'));
 assert.equal(financial.status,200);
 const dashboard=await financial.json() as {metrics:Array<{metricId:string;value:string}>};
 assert.equal(dashboard.metrics.find(metric=>metric.metricId==='receivables.outstanding')?.value,'0');
});
test('ownerless report and measurement mutations fail closed without changing records',async()=>{
 const page=await orderExecution(req('/api/orders/'+legacyOrder+'/execution'),{
   params:Promise.resolve({id:legacyOrder}),
 });
 assert.equal(page.status,404);
 const write=await reportExecution(req('/api/orders/'+legacyOrder+'/execution',report(1)),{
   params:Promise.resolve({id:legacyOrder}),
 });
 assert.equal(write.status,404);
 const approval=await orderCommand(req('/api/commands',{
  id:measurement,version:1,key:randomUUID(),command:'approve_measurement',
 }));
 assert.equal(approval.status,404);
 const rows=await pool.query('SELECT COUNT(*)::int AS n FROM execution_entries WHERE order_id=$1',[legacyOrder]);
 assert.equal(rows.rows[0].n,0);
 const status=await pool.query('SELECT status FROM measurements WHERE id=$1',[measurement]);
 assert.equal(status.rows[0].status,'approved');
});
test('authorized execution still enforces optimistic version before inserting facts',async()=>{
 const write=await reportExecution(req('/api/orders/'+ownedOrder+'/execution',report(1)),{
  params:Promise.resolve({id:ownedOrder}),
 });
 assert.equal(write.status,409);
 assert.equal((await write.json() as {code:string}).code,'VERSION_CONFLICT');
 const rows=await pool.query('SELECT COUNT(*)::int AS n FROM execution_entries WHERE order_id=$1',[ownedOrder]);
 assert.equal(rows.rows[0].n,0);
});

test('financial aging rejects nonexistent calendar dates without querying or mutating the ledger',async()=>{
 for(const asOf of ['2026-02-30','2026-13-01','2026-11-31']){
  const response=await finance(req('/api/finance/workspace?asOf='+asOf));
  assert.equal(response.status,400);
  assert.equal((await response.json() as {code:string}).code,'VALIDATION_FAILED');
 }
});
