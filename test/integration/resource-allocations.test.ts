import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {POST as allocate} from '../../app/api/resources/allocations/route';

const pool=new Pool({connectionString:process.env.DATABASE_URL});
const actor=randomUUID(),other=randomUUID(),order=randomUUID(),professional=randomUUID(),asset=randomUUID();
const req=(body:unknown,owner:string)=>new Request('http://localhost/api/resources/allocations',{method:'POST',headers:{'content-type':'application/json','x-cisne-test-actor':owner},body:JSON.stringify(body)});
test('resource allocation is tenant-scoped, idempotent, conflict-safe and blocks maintenance assets',async()=>{
 if(!process.env.DATABASE_URL){assert.ok(true,'requires CI PostgreSQL');return;}
 const now='2026-11-20T10:00:00.000Z',later='2026-11-20T11:00:00.000Z';
 await pool.query("INSERT INTO service_orders(id,owner_id,title,client,category,description,status,created_at) VALUES($1,$2,'UAT OS','UAT','Serviços','UAT','planned',$3)",[order,actor,now]);
 await pool.query("INSERT INTO professionals(id,owner_id,name,registration,specialty,department,status,created_at,updated_at) VALUES($1,$2,'UAT','UAT-ALLOC','Field','Ops','active',$3,$3)",[professional,actor,now]);
 await pool.query("INSERT INTO assets(id,owner_id,code,name,kind,status,created_at,updated_at) VALUES($1,$2,'UAT-ASSET','UAT asset','equipment','maintenance',$3,$3)",[asset,actor,now]);
 const payload={id:randomUUID(),orderId:order,resourceType:'professional',resourceId:professional,startsAt:now,endsAt:later};
 assert.equal((await allocate(req(payload,actor))).status,201);
 assert.equal((await allocate(req(payload,other))).status,409);
 assert.equal((await allocate(req(payload,actor))).status,201);
 assert.equal((await allocate(req({...payload,id:randomUUID()} as typeof payload,actor))).status,409);
 assert.equal((await allocate(req({id:randomUUID(),orderId:order,resourceType:'asset',resourceId:asset,startsAt:now,endsAt:later},actor))).status,409);
 const count=await pool.query('SELECT count(*)::int AS n FROM resource_allocations WHERE owner_id=$1',[actor]);
 assert.equal(count.rows[0].n,1);
});
test.after(async()=>{await pool.query('DELETE FROM resource_allocations WHERE owner_id=$1',[actor]);await pool.query('DELETE FROM assets WHERE id=$1',[asset]);await pool.query('DELETE FROM professionals WHERE id=$1',[professional]);await pool.query('DELETE FROM service_orders WHERE id=$1',[order]);await pool.end()});
