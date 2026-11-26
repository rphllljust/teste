import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {closeDatabase} from '../../db/raw';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {GET as audit} from '../../app/api/orders/[id]/audit/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
 throw Error('Operational audit requires disposable PostgreSQL.');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3});
const actor=randomUUID(),other=randomUUID();
const owned=randomUUID(),foreign=randomUUID(),legacy=randomUUID();
const measure=randomUUID();
const eventIds=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];
const path=(orderId:string,query='')=>'/api/orders/'+orderId+'/audit'+query;
const req=(actorId:string,url:string)=>setTestIdentity(new Request('http://localhost'+url),actorId);
const context=(id:string)=>({params:Promise.resolve({id})});
before(async()=>{
 const now='2026-11-26T19:00:00.000Z';
 for(const [id,owner] of [[owned,actor],[foreign,other],[legacy,null]] as const){
  await pool.query("INSERT INTO service_orders (id,owner_id,title,client,category,description,due_date,status,version,created_at) VALUES($1,$2,'Operational audit test','Test actor','Serviços','Append-only test','2099-01-01','completed',1,$3)",[id,owner,now]);
 }
 await pool.query("INSERT INTO measurements(id,order_id,description,amount,status,version,created_at) VALUES($1,$2,'Owned measurement',10000,'draft',1,$3)",[measure,owned,now]);
 const t=['2026-11-26T19:00:01.000Z','2026-11-26T19:00:02.000Z','2026-11-26T19:00:03.000Z'];
 for(let i=0;i<3;i++){
  await pool.query("INSERT INTO order_events(id,order_id,command,version,created_at,actor_id,target_id,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[eventIds[i],owned,['create','authorize','complete'][i],i+1,t[i],actor,owned,randomUUID()]);
 }
 await pool.query("INSERT INTO field_measurement_events(id,measurement_id,order_id,command,version,actor_id,request_hash,result,correlation_id,created_at) VALUES($1,$2,$3,'create',1,$4,$5,'{}',$6,$7)",[eventIds[3],measure,owned,actor,randomUUID(),randomUUID(),t[2]]);
});
after(async()=>{
 await pool.query('DELETE FROM field_measurement_events WHERE order_id=$1',[owned]);
 await pool.query('DELETE FROM order_events WHERE order_id=$1',[owned]);
 await pool.query('DELETE FROM measurements WHERE order_id=$1',[owned]);
 await pool.query('DELETE FROM service_orders WHERE id=ANY($1::text[])',[[owned,foreign,legacy]]);
 await closeDatabase();await pool.end();
});
test('audit exposes only owned order with exact origin',async()=>{
 const ok=await audit(req(actor,path(owned)),context(owned));
 assert.equal(ok.status,200);
 const data=await ok.json() as {items:Array<{id:string;correlationId:string|null;actorId:string|null}>;source:string};
 assert.equal(data.source,'postgres_owned_event_trace');
 assert.equal(data.items.length,4);
 assert.ok(data.items.every(x=>x.actorId===actor&&x.correlationId));
 assert.equal((await audit(req(actor,path(foreign)),context(foreign))).status,404);
 assert.equal((await audit(req(actor,path(legacy)),context(legacy))).status,404);
 assert.equal((await audit(req(other,path(owned)),context(owned))).status,404);
});
test('keyset merges order and measurement events despite equal timestamps',async()=>{
 const first=await audit(req(actor,path(owned,'?pageSize=2')),context(owned));
 assert.equal(first.status,200);
 const a=await first.json() as {items:Array<{id:string}>;pageInfo:{nextCursor:{cursorAt:string;cursorId:string;cursorSource:string}|null}};
 assert.equal(a.items.length,2);assert.ok(a.pageInfo.nextCursor);
 const params=new URLSearchParams(a.pageInfo.nextCursor!);params.set('pageSize','2');
 const second=await audit(req(actor,path(owned,'?'+params)),context(owned));
 assert.equal(second.status,200);
 const b=await second.json() as {items:Array<{id:string}>;pageInfo:{hasMore:boolean}};
 assert.equal(b.items.length,2);assert.equal(b.pageInfo.hasMore,false);
 assert.equal(new Set([...a.items,...b.items].map(x=>x.id)).size,4);
});
test('invalid cursor and unrecognized parameters are rejected',async()=>{
 assert.equal((await audit(req(actor,path('invalid')),context('invalid'))).status,400);
 assert.equal((await audit(req(actor,path(owned,'?pageSize=1&cursorAt=2026-11-26T00%3A00%3A00Z')),context(owned))).status,400);
 assert.equal((await audit(req(actor,path(owned,'?pageSize=1000')),context(owned))).status,400);
 assert.equal((await audit(req(actor,path(owned,'?unknown=foo')),context(owned))).status,400);
});
