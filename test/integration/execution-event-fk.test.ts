import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {closeDatabase} from '../../db/raw';
import {GET as listExecution,POST as command} from '../../app/api/orders/[id]/execution/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
  throw Error('EXECUTION_FK_NO_GO: disposable PostgreSQL required');
const target=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(target.hostname)||
  !['/cisne_test','/cisne_ci'].includes(target.pathname)||target.port!=='5432')
  throw Error('EXECUTION_FK_NO_GO: production/staging database refused');

const db=new Pool({connectionString:process.env.DATABASE_URL,max:2});
const owner=randomUUID(),outsider=randomUUID(),orderId=randomUUID();
function req(actor:string,path:string,method='GET',body?:unknown) {
  return setTestIdentity(new Request('http://localhost'+path,{
    method,headers:body===undefined?undefined:{'content-type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body),
  }),actor);
}
const ctx={params:Promise.resolve({id:orderId})};
function post(actor:string,body:unknown){
  return command(req(actor,'/api/orders/'+orderId+'/execution','POST',body),ctx);
}
function list(state='active'){
  return listExecution(req(owner,'/api/orders/'+orderId+'/execution?state='+state),ctx);
}
async function json(res:Response){return await res.clone().json() as Record<string,unknown>;}
after(async()=>{
  await db.query('DELETE FROM execution_entries WHERE order_id=$1',[orderId]);
  await db.query('DELETE FROM order_events WHERE order_id=$1',[orderId]);
  await db.query('DELETE FROM service_orders WHERE id=$1',[orderId]);
  await closeDatabase();await db.end();
});

test('execution record and reversal share their idempotency event ID, with correct status and FKs',async()=>{
  await db.query(
    "INSERT INTO service_orders(id,owner_id,title,client,category,description,status,version,created_at) VALUES($1,$2,$3,$4,$5,$6,'executing',3,$7)",
    [orderId,owner,'OS sintética de execução','Cliente CI','Serviços','Execução isolada',new Date().toISOString()],
  );
  const key=randomUUID();
  const report={
    command:'report',key,version:3,resourceKind:'labor',
    description:'Trabalho de instalação executado',quantity:'1,5',unit:'h',
    resourceReference:null,effectiveDate:'2026-12-03',reference:'CI-EXEC-001',
  };
  const unauthorized=await post(outsider,report);
  assert.equal(unauthorized.status,404);
  const stale=await post(owner,{...report,key:randomUUID(),version:2});
  assert.equal(stale.status,409);
  const recorded=await post(owner,report);
  assert.equal(recorded.status,201,JSON.stringify(await json(recorded)));
  const first=await json(recorded);
  assert.equal((first.resource as {id:string}).id,key);
  assert.equal((await post(owner,report)).status,201,'exact replay remains idempotent');
  const stored=await db.query(
    'SELECT e.id,e.order_id,e.reverses_id,ev.id AS event_id,ev.target_id FROM execution_entries e JOIN order_events ev ON ev.id=e.id WHERE e.id=$1',
    [key],
  );
  assert.equal(stored.rows.length,1);
  assert.equal(stored.rows[0].event_id,key);
  assert.equal(stored.rows[0].target_id,key);
  assert.equal(stored.rows[0].order_id,orderId);
  assert.equal(stored.rows[0].reverses_id,null);
  const before=await list();
  assert.equal(before.status,200);
  assert.equal((await json(before)).pageInfo && ((await json(before)).items as Array<unknown>).length,1);

  const voidKey=randomUUID();
  const revert={command:'void',key:voidKey,version:3,reversesId:key,reason:'Correção de registro CI'};
  const reversed=await post(owner,revert);
  assert.equal(reversed.status,201,JSON.stringify(await json(reversed)));
  const reversedBody=await json(reversed);
  assert.equal((reversedBody.resource as {id:string}).id,voidKey);
  assert.equal((await post(owner,revert)).status,201,'reversal replay must not duplicate');
  const duplicate=await post(owner,{...revert,key:randomUUID()});
  assert.equal(duplicate.status,409,'second reversal must be explicit conflict');
  const active=await json(await list());
  assert.equal((active.items as Array<unknown>).length,0,'voided original must leave active list');
  const corrected=await json(await list('corrected'));
  assert.equal((corrected.items as Array<unknown>).length,1);
  const pair=await db.query(
    'SELECT e.id,e.reverses_id,ev.command FROM execution_entries e JOIN order_events ev ON ev.id=e.id WHERE e.order_id=$1 ORDER BY ev.created_at,e.id',
    [orderId],
  );
  assert.equal(pair.rows.length,2);
  assert.deepEqual(new Set(pair.rows.map(x=>x.id)),new Set([key,voidKey]));
  assert.equal(pair.rows.find(x=>x.id===voidKey).reverses_id,key);

  await db.query("UPDATE service_orders SET status='completed',version=4 WHERE id=$1",[orderId]);
  assert.equal((await post(owner,report)).status,201,'prior receipt remains valid after OS completion');
  assert.equal((await post(owner,revert)).status,201,'prior reversal remains valid after completion');
});
