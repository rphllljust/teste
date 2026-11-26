import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {POST as allocate} from '../../app/api/resources/allocations/route';
import {GET as listAllocations} from '../../app/api/resources/allocations/route';
import {POST as releaseAllocation} from '../../app/api/resources/allocations/[id]/commands/route';

import {setTestIdentity} from '../../lib/api/test-identity.mjs';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
 throw new Error('RESOURCE_ALLOCATION_INTEGRATION_NO_GO: NODE_ENV=test and DATABASE_URL are required; test was not executed.');
const databaseUrl=new URL(process.env.DATABASE_URL);
if(!['127.0.0.1','localhost','::1'].includes(databaseUrl.hostname)&&process.env.CISNE_ALLOW_NON_LOOPBACK_INTEGRATION!=='true')
 throw new Error('RESOURCE_ALLOCATION_INTEGRATION_NO_GO: DATABASE_URL must target loopback PostgreSQL unless CISNE_ALLOW_NON_LOOPBACK_INTEGRATION=true.');
const pool=new Pool({connectionString:databaseUrl.toString()});
const actor=randomUUID(),other=randomUUID(),order=randomUUID(),professional=randomUUID(),professional2=randomUUID(),asset=randomUUID(),asset2=randomUUID();
const req=(body:unknown,owner:string)=>setTestIdentity(new Request('http://localhost/api/resources/allocations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),owner);
test('resource allocation is tenant-scoped, idempotent, conflict-safe and blocks maintenance assets',async()=>{
 if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for PostgreSQL resource allocation integration.');
 const now='2026-11-20T10:00:00.000Z',later='2026-11-20T11:00:00.000Z';
 await pool.query("INSERT INTO service_orders(id,owner_id,title,client,category,description,status,created_at) VALUES($1,$2,'UAT OS','UAT','Serviços','UAT','authorized',$3)",[order,actor,now]);
 await pool.query("INSERT INTO professionals(id,owner_id,name,registration,specialty,department,status,created_at,updated_at) VALUES($1,$2,'UAT','UAT-ALLOC','Field','Ops','active',$3,$3)",[professional,actor,now]);
 await pool.query("INSERT INTO professionals(id,owner_id,name,registration,specialty,department,status,created_at,updated_at) VALUES($1,$2,'UAT 2','UAT-ALLOC-2','Field','Ops','active',$3,$3)",[professional2,actor,now]);
 await pool.query("INSERT INTO assets(id,owner_id,code,name,kind,status,created_at,updated_at) VALUES($1,$2,'UAT-ASSET','UAT asset','equipment','maintenance',$3,$3)",[asset,actor,now]);
 await pool.query("INSERT INTO assets(id,owner_id,code,name,kind,status,created_at,updated_at) VALUES($1,$2,'UAT-ASSET-2','UAT asset 2','equipment','active',$3,$3)",[asset2,actor,now]);
 const payload={id:randomUUID(),orderId:order,resourceType:'professional',resourceId:professional,startsAt:now,endsAt:later};
 assert.equal((await allocate(req(payload,actor))).status,201);
 assert.equal((await allocate(req(payload,other))).status,409);
 assert.equal((await allocate(req(payload,actor))).status,201);
 assert.equal((await allocate(req({...payload,id:randomUUID()} as typeof payload,actor))).status,409);
 assert.equal((await allocate(req({id:randomUUID(),orderId:order,resourceType:'asset',resourceId:asset,startsAt:now,endsAt:later},actor))).status,409);
 const professionalRace=await Promise.all([professional2,professional2].map(resourceId=>allocate(req({id:randomUUID(),orderId:order,resourceType:'professional',resourceId,startsAt:now,endsAt:later},actor))));
 assert.deepEqual(professionalRace.map(response=>response.status).sort((a,b)=>a-b),[201,409]);
 const assetRace=await Promise.all([asset2,asset2].map(resourceId=>allocate(req({id:randomUUID(),orderId:order,resourceType:'asset',resourceId,startsAt:now,endsAt:later},actor))));
 assert.deepEqual(assetRace.map(response=>response.status).sort((a,b)=>a-b),[201,409]);
 const calendar=(who:string,query:string)=>
  setTestIdentity(new Request('http://localhost/api/resources/allocations?'+query),who);
 const week='from=2026-11-20&to=2026-11-27&resourceType=all&status=active';
 const ownerView=await listAllocations(calendar(actor,week));
 assert.equal(ownerView.status,200);
 const bookingRows=await ownerView.json() as {
  items:Array<{id:string;orderId:string;resourceId:string;rowVersion:number}>;
  limited:boolean;source:string;
 };
 assert.equal(bookingRows.source,'postgres_owner_scoped_allocations');
 assert.equal(bookingRows.limited,false);
 assert.equal(bookingRows.items.length,3);
 assert.ok(bookingRows.items.some(item=>item.id===payload.id&&item.orderId===order));
 const outside=await listAllocations(calendar(other,week));
 assert.equal(outside.status,200);
 assert.deepEqual((await outside.json() as {items:unknown[]}).items,[]);
 const outsideBook=await releaseAllocation(
  setTestIdentity(new Request('http://localhost/api/resources/allocations/'+payload.id+'/commands',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({key:randomUUID(),version:1,command:'release'}),
  }),other),{params:Promise.resolve({id:payload.id})});
 assert.equal(outsideBook.status,404);
 const release=await releaseAllocation(
  setTestIdentity(new Request('http://localhost/api/resources/allocations/'+payload.id+'/commands',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({key:randomUUID(),version:1,command:'release'}),
  }),actor),{params:Promise.resolve({id:payload.id})});
 assert.equal(release.status,201);
 const released=await listAllocations(calendar(actor,week));
 assert.equal((await released.json() as {items:unknown[]}).items.length,2);
 assert.equal((await listAllocations(calendar(actor,'from=2026-11-20&to=2027-02-01')).status,400);
 const count=await pool.query('SELECT count(*)::int AS n FROM resource_allocations WHERE owner_id=$1',[actor]);
 assert.equal(count.rows[0].n,3);
});
test.after(async()=>{await pool.query('DELETE FROM resource_allocation_events WHERE owner_id=$1',[actor]);await pool.query('DELETE FROM resource_allocations WHERE owner_id=$1',[actor]);await pool.query('DELETE FROM assets WHERE id=ANY($1::text[])',[[asset,asset2]]);await pool.query('DELETE FROM professionals WHERE id=ANY($1::text[])',[[professional,professional2]]);await pool.query('DELETE FROM service_orders WHERE id=$1',[order]);await pool.end()});
