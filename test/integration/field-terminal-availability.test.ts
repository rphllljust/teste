import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {closeDatabase} from '../../db/raw';
import {POST as registerPerson} from '../../app/api/field/people/route';
import {POST as plan} from '../../app/api/orders/[id]/planning/route';
import {GET as agenda} from '../../app/api/schedules/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
  throw Error('FIELD_AVAILABILITY_NO_GO: disposable CI database required');
const url=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(url.hostname)||
   !['/cisne_ci','/cisne_test'].includes(url.pathname)||url.port!=='5432')
  throw Error('FIELD_AVAILABILITY_NO_GO: refusing non-disposable PostgreSQL');

const owner=randomUUID(),personId=randomUUID(),ids=[randomUUID(),randomUUID(),randomUUID()];
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});
function request(path:string,method='GET',body?:unknown){
  return setTestIdentity(new Request('http://localhost'+path,{method,
    headers:body===undefined?undefined:{'content-type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body)}),owner);
}
function planning(id:string,payload:Record<string,unknown>){
  return plan(request('/api/orders/'+id+'/planning','POST',{key:randomUUID(),...payload}),
    {params:Promise.resolve({id})});
}
after(async()=>{
  try{
    await pool.query('DELETE FROM field_planning_events WHERE owner_id=$1',[owner]);
    await pool.query('DELETE FROM field_order_assignments WHERE owner_id=$1',[owner]);
    await pool.query('DELETE FROM field_order_schedules WHERE owner_id=$1',[owner]);
    await pool.query('DELETE FROM field_people WHERE owner_id=$1',[owner]);
    await pool.query('DELETE FROM service_orders WHERE id=ANY($1::text[])',[ids]);
  }finally{await closeDatabase();await pool.end();}
});

test('completed and cancelled OS free staff without deleting their historical assignments',async()=>{
  for(const id of ids){
    await pool.query(
      'INSERT INTO service_orders(id,owner_id,title,client,category,description,created_at) VALUES($1,$2,$3,$4,$5,$6,now())',
      [id,owner,'OS teste ocupação','Cliente de CI','Serviços','Cenário sintético'],
    );
  }
  const created=await registerPerson(request('/api/field/people','POST',{
    id:personId,fullName:'Profissional disponibilidade',specialty:'Manutenção predial',
  }));
  assert.equal(created.status,201);
  const start=new Date(Date.now()+7*86400000),end=new Date(start.getTime()+7200000);
  for(const id of ids){
    const saved=await planning(id,{command:'set_schedule',expectedVersion:0,
      startsAt:start.toISOString(),endsAt:end.toISOString(),location:'Unidade sintética'});
    assert.equal(saved.status,201,'All three orders can be scheduled without people yet');
  }
  const assign=(id:string)=>planning(id,{command:'assign_person',personId});
  assert.equal((await assign(ids[0])).status,201);
  assert.equal((await assign(ids[1])).status,409,'An active draft OS must block overlapping staff');

  await pool.query("UPDATE service_orders SET status='completed',version=version+1 WHERE id=$1",[ids[0]]);
  assert.equal((await assign(ids[1])).status,201,'Completed OS cannot reserve future staff slots');
  assert.equal((await assign(ids[2])).status,409,'Second active OS must still block third');

  await pool.query("UPDATE service_orders SET status='cancelled',version=version+1 WHERE id=$1",[ids[1]]);
  assert.equal((await assign(ids[2])).status,201,'Cancelled OS cannot reserve future staff slots');

  const rescheduled=await planning(ids[2],{command:'set_schedule',expectedVersion:1,
    startsAt:new Date(start.getTime()+1800000).toISOString(),
    endsAt:new Date(end.getTime()+1800000).toISOString(),location:'Outra unidade sintética'});
  assert.equal(rescheduled.status,201,'Updating assigned active OS must ignore terminal historical assignments');
  const rows=await pool.query(
    'SELECT a.order_id,o.status FROM field_order_assignments a JOIN service_orders o ON o.id=a.order_id WHERE a.owner_id=$1 AND a.person_id=$2 AND a.active=true',
    [owner,personId],
  );
  assert.deepEqual(rows.rows.map(row=>row.status).sort(),['cancelled','completed','draft'],
    'Historical assignment records remain auditable; availability is based on OS status');
  const response=await agenda(request('/api/schedules'));
  assert.equal(response.status,200);
  const data=await response.json() as {items:Array<{orderId:string}>};
  assert.deepEqual(data.items.map(x=>x.orderId),[ids[2]],'Operational agenda shows only the active appointment');
  assert.equal((await planning(ids[0],{command:'unassign_person',personId})).status,409,
    'Completed OS history remains immutable');
});
