import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {closeDatabase} from '../../db/raw';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {POST as createTenant} from '../../app/api/enterprise/tenants/route';
import {POST as changeMembership} from '../../app/api/enterprise/tenants/[id]/members/route';
import {GET as audit} from '../../app/api/enterprise/tenants/[id]/audit/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
 throw Error('Enterprise audit integration requires disposable PostgreSQL');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3});
const owner=randomUUID(),ownerB=randomUUID(),auditor=randomUUID(),operator=randomUUID(),stranger=randomUUID();
const tenantA=randomUUID(),tenantB=randomUUID();
const routeA={params:Promise.resolve({id:tenantA})},routeB={params:Promise.resolve({id:tenantB})};
const req=(actor:string,path:string,body?:unknown)=>setTestIdentity(new Request('http://localhost'+path,{
 method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},
 ...(body===undefined?{}:{body:JSON.stringify(body)}),
}),actor);
const url=(id:string,query='')=>'/api/enterprise/tenants/'+id+'/audit'+query;

before(async()=>{
 for(const [id,actor] of [[tenantA,owner],[tenantB,ownerB]]){
  const created=await createTenant(req(actor,'/api/enterprise/tenants',{
   id,commandKey:randomUUID(),slug:'audit-'+id.slice(0,8),name:'Audit Test '+id.slice(0,8),
  }));
  assert.equal(created.status,201);
 }
 for(const [target,role] of [[auditor,'auditor'],[operator,'operator']] as const){
  const result=await changeMembership(req(owner,'/api/enterprise/tenants/'+tenantA+'/members',{
   commandKey:randomUUID(),action:'provision',actorId:target,role,
  }),routeA);
  assert.equal(result.status,201);
 }
});
after(async()=>{
 for(const tenantId of [tenantA,tenantB]){
  await pool.query('DELETE FROM enterprise_permission_events WHERE tenant_id=$1',[tenantId]);
  await pool.query('DELETE FROM enterprise_tenant_memberships WHERE tenant_id=$1',[tenantId]);
  await pool.query('DELETE FROM enterprise_tenants WHERE id=$1',[tenantId]);
  await pool.query("DELETE FROM business_commands WHERE entity_id=$1 AND entity_type IN ('enterpriseTenant','enterpriseMembership')",[tenantId]);
 }
 await closeDatabase();await pool.end();
});
test('audit role is authorized, but operator and unrelated tenant are denied',async()=>{
 const allowed=await audit(req(auditor,url(tenantA)),routeA);
 assert.equal(allowed.status,200);
 const payload=await allowed.json() as {items:Array<{action:string}>};
 assert.ok(payload.items.some(x=>x.action==='tenant.created'));
 assert.ok(payload.items.some(x=>x.action==='membership.provisioned'));
 assert.equal((await audit(req(operator,url(tenantA)),routeA)).status,403);
 assert.equal((await audit(req(stranger,url(tenantA)),routeA)).status,404);
 assert.equal((await audit(req(auditor,url(tenantB)),routeB)).status,404);
});
test('keyset pagination does not skip or duplicate permission events',async()=>{
 const first=await audit(req(owner,url(tenantA,'?pageSize=2')),routeA);
 assert.equal(first.status,200);
 const page=await first.json() as {
  items:Array<{id:string;createdAt:string;correlationId:string}>;
  pageInfo:{pageSize:number;hasMore:boolean;nextCursor:{cursorAt:string;cursorId:string}|null};
 };
 assert.equal(page.items.length,2);
 assert.equal(page.pageInfo.hasMore,true);
 assert.ok(page.pageInfo.nextCursor);
 assert.ok(page.items.every(e=>e.correlationId.length>0));
 const cursor=new URLSearchParams({pageSize:'2',...page.pageInfo.nextCursor!}).toString();
 const second=await audit(req(owner,url(tenantA,'?'+cursor)),routeA);
 assert.equal(second.status,200);
 const next=await second.json() as typeof page;
 assert.ok(next.items.length>0);
 assert.ok(next.items.every(e=>!page.items.some(old=>old.id===e.id)));
 const count=await pool.query('SELECT count(*)::int AS n FROM enterprise_permission_events WHERE tenant_id=$1',[tenantA]);
 assert.equal(new Set([...page.items,...next.items].map(e=>e.id)).size,count.rows[0].n);
});
test('reject invalid tenant, unsupported query parameters and incomplete cursors',async()=>{
 assert.equal((await audit(req(owner,url(tenantA,'?cursorId='+randomUUID())),routeA)).status,400);
 assert.equal((await audit(req(owner,url(tenantA,'?pageSize=51')),routeA)).status,400);
 assert.equal((await audit(req(owner,url(tenantA,'?role=owner')),routeA)).status,400);
 assert.equal((await audit(req(owner,url('not-a-uuid')),{params:Promise.resolve({id:'not-a-uuid'})})).status,400);
});
