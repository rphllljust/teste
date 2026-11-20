import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {closeDatabase} from '../../db/raw';
import {POST as registerPayable} from '../../app/api/payables/route';
import {GET as getTower} from '../../app/api/enterprise/control-tower/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
 throw new Error('NO-GO: control tower PostgreSQL evidence requires disposable test DB');
const url=new URL(process.env.DATABASE_URL);
if(!['127.0.0.1','localhost'].includes(url.hostname)||url.port!=='5432'||
   !['/cisne_test','/cisne_ci'].includes(url.pathname))
 throw new Error('NO-GO: cannot run control tower integration against nonlocal database');

test('owner-scoped seven-lane control tower reads the whole ledger, rejects cross-owner facts and never writes',async()=>{
 const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});
 const owner=randomUUID(),outsider=randomUUID();
 const orderId=randomUUID(),foreignOrderId=randomUUID();
 const payableId=randomUUID(),foreignPayableId=randomUUID();
 function req(method:string,path:string,actor?:string,body?:unknown){
  const request=new Request('http://localhost'+path,{
   method,headers:{'content-type':'application/json'},
   body:body?JSON.stringify(body):undefined,
  });
  return actor?setTestIdentity(request,actor):request;
 }
 try{
  const now=new Date().toISOString();
  for(const [id,actor] of [[orderId,owner],[foreignOrderId,outsider]]){
   await pool.query(
    "INSERT INTO service_orders(id,owner_id,title,client,category,description,created_at,status,due_date) VALUES($1,$2,'OS vencida CI','Cliente CI','Serviços','OS sintética isolada',$3,'authorized','2026-10-01')",
    [id,actor,now]);
  }
  for(const [id,actor] of [[payableId,owner],[foreignPayableId,outsider]]){
   const response=await registerPayable(req('POST','/api/payables',actor,{
    id,supplier:'Fornecedor CI',sourceReference:'DOC-CI-001',
    description:'Obrigação sintética para auditoria',amount:'25,00',dueDate:'2026-10-02',
   }));
   assert.equal(response.status,201,JSON.stringify(await response.clone().json()));
  }
  const response=await getTower(req('GET','/api/enterprise/control-tower?asOf=2026-11-20',owner));
  assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
  const body=await response.json() as {authority:string;sampleLimitPerLane:number;lanes:Array<{
   id:string;count:number;totalAmountScaled:string|null;
   items:Array<{id:string;title:string}>;
  }>};
  assert.equal(body.authority,'owner_scoped_persisted_postgresql.v1');
  assert.equal(body.lanes.length,7);
  assert.equal(body.sampleLimitPerLane,6);
  assert.equal(body.lanes.find(lane=>lane.id==='lateOrders')?.count,1);
  assert.deepEqual(body.lanes.find(lane=>lane.id==='lateOrders')?.items.map(item=>item.id),[orderId]);
  const payable=body.lanes.find(lane=>lane.id==='overduePayables');
  assert.equal(payable?.count,1);
  assert.equal(payable?.totalAmountScaled,'250000');
  assert.deepEqual(payable?.items.map(item=>item.id),[payableId]);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal((await getTower(req('GET','/api/enterprise/control-tower?asOf=2026-02-30',owner))).status,400);
  assert.equal((await getTower(req('GET','/api/enterprise/control-tower?unknown=1',owner))).status,400);
  assert.equal((await getTower(req('GET','/api/enterprise/control-tower'))).status,401);
  const foreign=await getTower(req('GET','/api/enterprise/control-tower?asOf=2026-11-20',outsider));
  assert.equal(foreign.status,200);
  const foreignBody=await foreign.json() as typeof body;
  assert.deepEqual(foreignBody.lanes.find(lane=>lane.id==='lateOrders')?.items.map(item=>item.id),[foreignOrderId]);
  assert.deepEqual(foreignBody.lanes.find(lane=>lane.id==='overduePayables')?.items.map(item=>item.id),[foreignPayableId]);
 }finally{
  for(const [payable,actor] of [[payableId,owner],[foreignPayableId,outsider]]){
   await pool.query("DELETE FROM finance_audit_events WHERE entity_type='payable' AND entity_id=$1",[payable]);
   await pool.query('DELETE FROM payable_payments WHERE payable_id=$1',[payable]);
   await pool.query('DELETE FROM payables WHERE id=$1 AND actor_id=$2',[payable,actor]);
  }
  await pool.query('DELETE FROM order_events WHERE order_id=ANY($1::text[])',[[orderId,foreignOrderId]]);
  await pool.query('DELETE FROM service_orders WHERE id=ANY($1::text[])',[[orderId,foreignOrderId]]);
  await closeDatabase();await pool.end();
 }
});
