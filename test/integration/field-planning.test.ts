import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {closeDatabase} from '../../db/raw';
import {GET as peopleGET,POST as peoplePOST} from '../../app/api/field/people/route';
import {GET as planningGET,POST as planningPOST} from '../../app/api/orders/[id]/planning/route';
import {GET as scheduleGET} from '../../app/api/schedules/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
  throw Error('FIELD_PLANNING_NO_GO: disposable CI database required');
const dbUrl=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(dbUrl.hostname)||
  !['/cisne_ci','/cisne_test'].includes(dbUrl.pathname)||dbUrl.port!=='5432')
  throw Error('FIELD_PLANNING_NO_GO: refusing non-disposable database');

const db=new Pool({connectionString:process.env.DATABASE_URL,max:2});
const owner=randomUUID(),other=randomUUID();
const first=randomUUID(),second=randomUUID(),external=randomUUID();
const personId=randomUUID();
function req(actor:string,path:string,method='GET',body?:unknown){
  const request=new Request('http://localhost'+path,{method,
    headers:body===undefined?undefined:{'Content-Type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body)});
  return setTestIdentity(request,actor);
}
function planning(actor:string,id:string,method='GET',body?:unknown){
  return method==='POST'?planningPOST(req(actor,'/api/orders/'+id+'/planning',method,body),
    {params:Promise.resolve({id})}):planningGET(req(actor,'/api/orders/'+id+'/planning'),
    {params:Promise.resolve({id})});
}
async function parse(r:Response){return await r.json() as {
  error?:string;items?:Array<{id:string;orderId?:string}>;replayed?:boolean;
  schedule?:{location:string;version:number};assignments?:Array<{personId:string}>;
};}

after(async()=>{
  await db.query('DELETE FROM field_planning_events WHERE owner_id=ANY($1::text[])',[[owner,other]]);
  await db.query('DELETE FROM field_order_assignments WHERE owner_id=ANY($1::text[])',[[owner,other]]);
  await db.query('DELETE FROM field_order_schedules WHERE owner_id=ANY($1::text[])',[[owner,other]]);
  await db.query('DELETE FROM field_people WHERE owner_id=ANY($1::text[])',[[owner,other]]);
  await db.query('DELETE FROM service_orders WHERE id=ANY($1::text[])',[[first,second,external]]);
  await closeDatabase();await db.end();
});

test('Field schedule, people, overlap conflict, assignments and replay persist in PostgreSQL',async()=>{
  const now=new Date().toISOString();
  for(const [id,actor] of [[first,owner],[second,owner],[external,other]]){
    await db.query(
      'INSERT INTO service_orders(id,owner_id,title,client,category,description,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [id,actor,'OS de homologação Field','Cliente sintético','Serviços','Somente CI',now],
    );
  }
  const person={id:personId,fullName:'Profissional de teste',specialty:'Técnico operacional'};
  const created=await peoplePOST(req(owner,'/api/field/people','POST',person));
  assert.equal(created.status,201,JSON.stringify(await parse(created)));
  assert.equal((await peoplePOST(req(owner,'/api/field/people','POST',person))).status,200);
  const visible=await parse(await peopleGET(req(owner,'/api/field/people')));
  assert.ok(visible.items?.some(item=>item.id===personId));
  const hidden=await parse(await peopleGET(req(other,'/api/field/people')));
  assert.equal(hidden.items?.length,0);
  assert.equal((await peoplePOST(req(other,'/api/field/people','POST',person))).status,409);

  const firstSlot={key:randomUUID(),command:'set_schedule',expectedVersion:0,
    startsAt:'2026-12-03T12:00:00.000Z',endsAt:'2026-12-03T14:00:00.000Z',
    location:'Oficina operacional CI'};
  const scheduled=await planning(owner,first,'POST',firstSlot);
  assert.equal(scheduled.status,201,JSON.stringify(await parse(scheduled)));
  const replay=await planning(owner,first,'POST',firstSlot);
  assert.equal(replay.status,200);
  assert.equal((await parse(replay)).replayed,true);
  const state=await parse(await planning(owner,first));
  assert.equal(state.schedule?.version,1);
  assert.equal(state.schedule?.location,'Oficina operacional CI');
  assert.equal((await planning(owner,first,'POST',{...firstSlot,key:randomUUID(),expectedVersion:0})).status,409);

  const assignment={key:randomUUID(),command:'assign_person',personId};
  const assigned=await planning(owner,first,'POST',assignment);
  assert.equal(assigned.status,201,JSON.stringify(await parse(assigned)));
  assert.equal((await planning(owner,first,'POST',assignment)).status,200);
  assert.equal((await planning(owner,first,'POST',{...assignment,key:randomUUID()})).status,409);
  assert.equal((await parse(await planning(owner,first))).assignments?.length,1);

  const competing={key:randomUUID(),command:'set_schedule',expectedVersion:0,
    startsAt:'2026-12-03T12:30:00.000Z',endsAt:'2026-12-03T13:30:00.000Z',
    location:'Outro local CI'};
  assert.equal((await planning(owner,second,'POST',competing)).status,201);
  const conflicting=await planning(owner,second,'POST',{key:randomUUID(),command:'assign_person',personId});
  assert.equal(conflicting.status,409,JSON.stringify(await parse(conflicting)));

  const agenda=await parse(await scheduleGET(req(owner,'/api/schedules')));
  assert.ok(agenda.items?.some(item=>item.orderId===first));
  assert.ok(agenda.items?.some(item=>item.orderId===second));
  const otherAgenda=await parse(await scheduleGET(req(other,'/api/schedules')));
  assert.equal(otherAgenda.items?.length,0);
  assert.equal((await planning(other,first)).status,404);
  assert.equal((await planning(owner,external)).status,404);
  assert.equal((await planning(other,first,'POST',{...firstSlot,key:randomUUID()})).status,404);

  const moved=await planning(owner,first,'POST',{...firstSlot,key:randomUUID(),expectedVersion:1,
    startsAt:'2026-12-03T12:15:00.000Z'});
  assert.equal(moved.status,201);
  const removed=await planning(owner,first,'POST',{key:randomUUID(),command:'unassign_person',personId});
  assert.equal(removed.status,201);
  assert.equal((await parse(await planning(owner,first))).assignments?.length,0);
  assert.equal((await planning(owner,second,'POST',{key:randomUUID(),command:'assign_person',personId})).status,201);
  const facts=await db.query(
    'SELECT (SELECT COUNT(*)::int FROM field_order_schedules WHERE owner_id=$1) AS schedules,(SELECT COUNT(*)::int FROM field_planning_events WHERE owner_id=$1) AS events,(SELECT COUNT(*)::int FROM field_order_assignments WHERE owner_id=$1 AND active=true) AS active',
    [owner],
  );
  assert.equal(facts.rows[0].schedules,2);
  assert.equal(facts.rows[0].events,6);
  assert.equal(facts.rows[0].active,1);

  await db.query("UPDATE service_orders SET status='completed' WHERE id=$1",[second]);
  assert.equal((await planning(owner,second,'POST',{...competing,key:randomUUID(),expectedVersion:1})).status,409);
});
