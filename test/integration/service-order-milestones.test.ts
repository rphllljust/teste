import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {closeDatabase} from '../../db/raw';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {GET,POST} from '../../app/api/orders/[id]/milestones/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
 throw Error('NO-GO: milestones need disposable PostgreSQL');
const url=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(url.hostname)
 ||!['/cisne_ci','/cisne_test'].includes(url.pathname)
 ||!['cisne_ci','cisne_test'].includes(url.username))
 throw Error('NO-GO: immutable milestones may only be tested in isolated CI DB');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});
const owner=randomUUID(),other=randomUUID(),order=randomUUID(),
 cancelled=randomUUID(),legacy=randomUUID(),eventKey=randomUUID();
const req=(id:string,identity:string|undefined,body?:unknown)=>{
 const request=new Request('http://localhost/api/orders/'+id+'/milestones',body===undefined?{}:{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)
 });
 return identity?setTestIdentity(request,identity):request;
};
const get=(id:string,actor?:string)=>GET(req(id,actor),{params:Promise.resolve({id})});
const post=(id:string,actor:string,body:unknown)=>
 POST(req(id,actor,body),{params:Promise.resolve({id})});
type Result={revision:number;items:Array<{code:string;active:boolean;canRecord:boolean;
 source:{id:string;reference:string}|null}>;
 history:Array<{command:string;checkpoint:string}>;pageInfo:{total:number}};
before(async()=>{
 const now=new Date().toISOString();
 for(const [id,status,actor] of [[order,'authorized',owner],
  [cancelled,'cancelled',owner],[legacy,'draft',null]]){
  await pool.query(`INSERT INTO service_orders
   (id,owner_id,title,client,category,description,status,created_at)
   VALUES($1,$2,'CI Milestone OS','CI Client','Serviços','CI only',$3,$4)`,
   [id,actor,status,now]);
 }
});
after(async()=>{
 // This test deliberately keeps immutable events in its strictly disposable
 // CI database. Deleting their source records would violate audit integrity.
 await closeDatabase();await pool.end();
});
test('milestones require an owned OS and never expose ownerless legacy data',async()=>{
 assert.equal((await get(order)).status,401);
 assert.equal((await get(order,other)).status,404);
 assert.equal((await get(legacy,owner)).status,404);
 assert.equal((await get('bad',owner)).status,400);
 const response=await get(order,owner);
 assert.equal(response.status,200);
 const data=await response.json() as Result;
 assert.equal(data.revision,0);
 assert.equal(data.items.length,6);
 assert.equal(data.items.find(x=>x.code==='site_readiness')?.canRecord,true);
});
test('records actual owner milestones, rejects replay conflicts, and immutably revokes',async()=>{
 const command={command:'record',key:eventKey,expectedRevision:0,checkpoint:'site_readiness',
  reference:'CI-OS-2026-001',note:'Equipe conferiu as condições iniciais da frente.'};
 const first=await post(order,owner,command);
 assert.equal(first.status,201,JSON.stringify(await first.clone().json()));
 const firstBody=await first.json() as {resource:{revision:number}};
 assert.equal(firstBody.resource.revision,1);
 const replay=await post(order,owner,command);
 assert.equal(replay.status,200);
 assert.equal((await replay.json() as {replayed:boolean}).replayed,true);
 assert.equal((await post(order,owner,{...command,key:randomUUID()})).status,409);
 assert.equal((await post(order,other,{...command,key:randomUUID(),expectedRevision:1})).status,404);
 const read=await(await get(order,owner)).json() as Result;
 assert.equal(read.revision,1);
 assert.equal(read.items.find(v=>v.code==='site_readiness')?.active,true);
 const target=read.items.find(v=>v.code==='site_readiness')?.source?.id;
 assert.equal(target,eventKey);
 const revoke={command:'revoke',key:randomUUID(),expectedRevision:1,
  targetId:eventKey,reason:'Registro substituído após nova conferência documentada.'};
 const revoked=await post(order,owner,revoke);
 assert.equal(revoked.status,201);
 assert.equal((await post(order,owner,revoke)).status,200);
 const state=await(await get(order,owner)).json() as Result;
 assert.equal(state.revision,2);
 assert.equal(state.items.find(v=>v.code==='site_readiness')?.active,false);
 assert.deepEqual(state.history.slice(0,2).map(v=>v.command),['revoke','record']);
 assert.equal((await post(order,owner,{...revoke,key:randomUUID(),expectedRevision:2})).status,409);
 await assert.rejects(
  pool.query('UPDATE service_order_milestone_events SET note=$1 WHERE id=$2',
   ['Unsafe silent rewrite',eventKey]),/CISNE_MILESTONE_IMMUTABLE/);
});
test('order lock serializes concurrent evidence without changing OS lifecycle version',async()=>{
 const beforeVersion=await pool.query('SELECT version FROM service_orders WHERE id=$1',[order]);
 const commands=['resources_verified','safety_reviewed'].map(checkpoint=>({
  command:'record',key:randomUUID(),expectedRevision:2,checkpoint,
  reference:'CI-AUDIT-2026',note:'Registro auditável de controle e conferência.'
 }));
 const raced=await Promise.all(commands.map(x=>post(order,owner,x)));
 assert.deepEqual(raced.map(x=>x.status).sort((a,b)=>a-b),[201,409]);
 const afterVersion=await pool.query('SELECT version FROM service_orders WHERE id=$1',[order]);
 assert.equal(afterVersion.rows[0].version,beforeVersion.rows[0].version);
 const current=await(await get(order,owner)).json() as Result;
 assert.equal(current.revision,3);
 assert.equal(current.pageInfo.total,3);
});
test('cancelled OS rejects new milestones and malformed requests',async()=>{
 assert.equal((await post(cancelled,owner,{command:'record',key:randomUUID(),
  expectedRevision:0,checkpoint:'quality_checked',reference:'CI-REF-1',
  note:'Tentativa posterior ao cancelamento da ordem.'})).status,409);
 assert.equal((await post(order,owner,{command:'record',key:randomUUID(),
  expectedRevision:3,checkpoint:'invalid',reference:'CI-REF-1',
  note:'Um marco que não existe no catálogo.'})).status,400);
});
