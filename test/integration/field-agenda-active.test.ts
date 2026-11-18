import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {closeDatabase} from '../../db/raw';
import {GET as scheduleGET} from '../../app/api/schedules/route';
import {POST as peoplePOST} from '../../app/api/field/people/route';
import {POST as planningPOST} from '../../app/api/orders/[id]/planning/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
  throw Error('FIELD_AGENDA_NO_GO: disposable CI database required');
const target=new URL(process.env.DATABASE_URL);
if(!['127.0.0.1','localhost'].includes(target.hostname)||
   !['/cisne_test','/cisne_ci'].includes(target.pathname)||target.port!=='5432')
  throw Error('FIELD_AGENDA_NO_GO: refusing non-disposable PostgreSQL');

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3});
const owner=randomUUID(),other=randomUUID();
function req(actor:string,path:string,method='GET',data?:unknown){
  return setTestIdentity(new Request('http://localhost'+path,{
    method,headers:data===undefined?undefined:{'content-type':'application/json'},
    body:data===undefined?undefined:JSON.stringify(data),
  }),actor);
}
async function plan(id:string,command:Record<string,unknown>){
  return planningPOST(req(owner,'/api/orders/'+id+'/planning','POST',command),
    {params:Promise.resolve({id})});
}
async function makeOrder(id:string){
  await pool.query(
    'INSERT INTO service_orders(id,owner_id,title,client,category,description,created_at) VALUES($1,$2,$3,$4,$5,$6,now())',
    [id,owner,'OS teste agenda','Cliente sintético','Serviços','Apenas PostgreSQL CI'],
  );
}
async function makeSchedule(id:string,from:Date,to:Date){
  return plan(id,{key:randomUUID(),command:'set_schedule',expectedVersion:0,
    startsAt:from.toISOString(),endsAt:to.toISOString(),location:'Sala de homologação CI'});
}
after(async()=>{
  try{
    await pool.query('DELETE FROM field_planning_events WHERE owner_id=$1',[owner]);
    await pool.query('DELETE FROM field_order_assignments WHERE owner_id=$1',[owner]);
    await pool.query('DELETE FROM field_order_schedules WHERE owner_id=$1',[owner]);
    await pool.query('DELETE FROM field_people WHERE owner_id=$1',[owner]);
    await pool.query('DELETE FROM service_orders WHERE owner_id=$1',[owner]);
  }finally{
    await closeDatabase();await pool.end();
  }
});

test('agenda excludes completed/cancelled OS before 100-row LIMIT and prioritizes upcoming over overdue',async()=>{
  const oldIds=Array.from({length:105},()=>randomUUID());
  await pool.query(
    "INSERT INTO service_orders(id,owner_id,title,client,category,description,status,created_at) SELECT c.id,$2,'OS encerrada CI','Cliente CI','Serviços','Somente CI','completed',now() FROM unnest($1::text[]) AS c(id)",
    [oldIds,owner],
  );
  await pool.query(
    "INSERT INTO field_order_schedules(order_id,owner_id,starts_at,ends_at,location) SELECT c.id,$2,now()-interval '5 years',now()-interval '5 years'+interval '1 hour','Histórico CI' FROM unnest($1::text[]) AS c(id)",
    [oldIds,owner],
  );
  const overdueId=randomUUID(),upcomingId=randomUUID();
  await makeOrder(overdueId);
  await makeOrder(upcomingId);
  const overdueStart=new Date(Date.now()-7*86400000);
  const upcomingStart=new Date(Date.now()+7*86400000);
  assert.equal((await makeSchedule(overdueId,overdueStart,new Date(overdueStart.getTime()+3600000))).status,201);
  assert.equal((await makeSchedule(upcomingId,upcomingStart,new Date(upcomingStart.getTime()+3600000))).status,201);

  const response=await scheduleGET(req(owner,'/api/schedules'));
  assert.equal(response.status,200);
  const result=await response.json() as {items:Array<{orderId:string;status:string}>};
  assert.deepEqual(result.items.map(item=>item.orderId),[upcomingId,overdueId]);
  assert.ok(result.items.every(item=>item.status!=='completed'&&item.status!=='cancelled'));
  const outsider=await scheduleGET(req(other,'/api/schedules'));
  assert.equal(outsider.status,200);
  assert.deepEqual((await outsider.json() as {items:unknown[]}).items,[]);
});

test('concurrent attempts to assign same person to overlapping orders serialize in PostgreSQL',async()=>{
  const a=randomUUID(),b=randomUUID(),personId=randomUUID();
  await makeOrder(a);await makeOrder(b);
  const from=new Date(Date.now()+10*86400000),to=new Date(from.getTime()+7200000);
  assert.equal((await makeSchedule(a,from,to)).status,201);
  assert.equal((await makeSchedule(b,from,to)).status,201);
  const created=await peoplePOST(req(owner,'/api/field/people','POST',{
    id:personId,fullName:'Profissional concorrência CI',specialty:'Técnico de campo',
  }));
  assert.equal(created.status,201);
  const results=await Promise.all([
    plan(a,{key:randomUUID(),command:'assign_person',personId}),
    plan(b,{key:randomUUID(),command:'assign_person',personId}),
  ]);
  assert.deepEqual(results.map(result=>result.status).sort((x,y)=>x-y),[201,409]);
  const active=await pool.query(
    'SELECT order_id FROM field_order_assignments WHERE owner_id=$1 AND person_id=$2 AND active=true',
    [owner,personId],
  );
  assert.equal(active.rows.length,1,'Apenas uma OS pode manter o profissional no intervalo');
});
