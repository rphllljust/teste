import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {closeDatabase} from '../../db/raw';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {GET as listTenants,POST as createTenant} from '../../app/api/enterprise/tenants/route';
import {GET as listEntities,POST as createEntity} from '../../app/api/enterprise/tenants/[id]/legal-entities/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)throw new Error('Disposable PostgreSQL required');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3});
const actor=randomUUID(),stranger=randomUUID(),tenantId=randomUUID(),entityId=randomUUID();
const route={params:Promise.resolve({id:tenantId})};
const url='/api/enterprise/tenants';
const childUrl=url+'/'+tenantId+'/legal-entities';
const req=(who:string,path:string,body?:unknown)=>setTestIdentity(new Request('http://localhost'+path,{
  method:body===undefined?'GET':'POST',
  headers:{'content-type':'application/json'},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),
}),who);

after(async()=>{
  await pool.query('DELETE FROM enterprise_permission_events WHERE tenant_id=$1',[tenantId]);
  await pool.query('DELETE FROM enterprise_legal_entities WHERE tenant_id=$1',[tenantId]);
  await pool.query('DELETE FROM enterprise_tenant_memberships WHERE tenant_id=$1',[tenantId]);
  await pool.query('DELETE FROM enterprise_tenants WHERE id=$1',[tenantId]);
  await pool.query("DELETE FROM business_commands WHERE actor_id=$1 AND entity_type IN ('enterpriseTenant','enterpriseLegalEntity')",[actor]);
  await closeDatabase();
  await pool.end();
});

test('tenant foundation creates only actor-owned organization and idempotent audit',async()=>{
  const input={id:tenantId,commandKey:randomUUID(),slug:'ci-'+tenantId.slice(0,8),name:'Grupo Empresarial Sintético'};
  const created=await createTenant(req(actor,url,input));
  assert.equal(created.status,201,JSON.stringify(await created.clone().json()));
  assert.equal((await createTenant(req(actor,url,input))).status,200);
  assert.equal((await createTenant(req(stranger,url,input))).status,409);
  const listed=await listTenants(req(actor,url));
  assert.equal(listed.status,200);
  assert.ok((await listed.json() as {items:Array<{id:string;role:string}>}).items.some(x=>x.id===tenantId&&x.role==='owner'));
  const other=await listTenants(req(stranger,url));
  assert.equal(other.status,200);
  assert.ok(!(await other.json() as {items:Array<{id:string}>}).items.some(x=>x.id===tenantId));
  assert.equal((await pool.query('SELECT role FROM enterprise_tenant_memberships WHERE tenant_id=$1 AND actor_id=$2',[tenantId,actor])).rows[0].role,'owner');
});

test('legal entity creation is membership scoped, audited and retry safe',async()=>{
  const input={id:entityId,commandKey:randomUUID(),code:'MATRIZ',name:'Matriz Sintética',taxId:'12345678901234'};
  assert.equal((await createEntity(req(stranger,childUrl,input),route)).status,404);
  assert.equal((await listEntities(req(stranger,childUrl),route)).status,404);
  assert.equal((await createEntity(req(actor,childUrl,input),route)).status,201);
  assert.equal((await createEntity(req(actor,childUrl,input),route)).status,200);
  const listing=await listEntities(req(actor,childUrl),route);
  assert.equal(listing.status,200);
  assert.deepEqual((await listing.json() as {items:Array<{id:string}>}).items.map(x=>x.id),[entityId]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM enterprise_permission_events WHERE tenant_id=$1',[tenantId])).rows[0].n,2);
});
