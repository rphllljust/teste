import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { closeDatabase } from '../../db/raw';
import { setTestIdentity } from '../../lib/api/test-identity.mjs';
import { POST as createTenant } from '../../app/api/enterprise/tenants/route';
import { POST as createEntity } from '../../app/api/enterprise/tenants/[id]/legal-entities/route';
import { GET as listCnaes, POST as registerCnaes } from '../../app/api/enterprise/tenants/[id]/legal-entities/[entityId]/cnaes/route';

if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL)
  throw new Error('Disposable PostgreSQL required for CNAE integration tests');

const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3});
const owner=randomUUID(), operator=randomUUID(), outsider=randomUUID();
const tenantId=randomUUID(), entityId=randomUUID();
const tenantPath='/api/enterprise/tenants',entityPath=tenantPath+'/'+tenantId+'/legal-entities';
const path=entityPath+'/'+entityId+'/cnaes';
const route={params:Promise.resolve({id:tenantId,entityId})};

const request=(actor:string,url:string,body?:unknown)=>setTestIdentity(new Request('http://localhost'+url,{
  method:body===undefined?'GET':'POST',
  headers:{'Content-Type':'application/json'},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),
}),actor);

after(async()=>{
  try{
    await pool.query('DELETE FROM enterprise_legal_entity_cnaes WHERE tenant_id=$1',[tenantId]);
    await pool.query('DELETE FROM enterprise_permission_events WHERE tenant_id=$1',[tenantId]);
    await pool.query('DELETE FROM enterprise_legal_entities WHERE tenant_id=$1',[tenantId]);
    await pool.query('DELETE FROM enterprise_tenant_memberships WHERE tenant_id=$1',[tenantId]);
    await pool.query('DELETE FROM enterprise_tenants WHERE id=$1',[tenantId]);
    await pool.query(
      "DELETE FROM business_commands WHERE actor_id=$1 AND entity_type IN ('enterpriseTenant','enterpriseLegalEntity','enterpriseLegalEntityCnaeProfile')",
      [owner],
    );
  }finally{await closeDatabase();await pool.end();}
});

test('CNAE profile is durable, company-scoped, auditable, authorized and idempotent',async()=>{
  const tenant={id:tenantId,commandKey:randomUUID(),slug:'cnae-'+tenantId.slice(0,8),name:'Grupo de Teste CNAE'};
  assert.equal((await createTenant(request(owner,tenantPath,tenant))).status,201);
  const entity={id:entityId,commandKey:randomUUID(),code:'MATRIZ',name:'Empresa Fictícia',taxId:'12345678901234'};
  assert.equal((await createEntity(request(owner,entityPath,entity),{
    params:Promise.resolve({id:tenantId}),
  })).status,201);
  await pool.query(
    "INSERT INTO enterprise_tenant_memberships(tenant_id,actor_id,role,created_at) VALUES($1,$2,'operator',$3)",
    [tenantId,operator,new Date().toISOString()],
  );

  assert.equal((await listCnaes(request(outsider,path),route)).status,404);
  const before=await listCnaes(request(owner,path),route);
  assert.equal(before.status,200);
  const catalog=await before.json() as {items:unknown[];declaredProfile:Array<{code:string;isPrimary:boolean}>};
  assert.equal(catalog.items.length,0);
  assert.equal(catalog.declaredProfile.length,49);
  assert.equal(catalog.declaredProfile.filter(x=>x.isPrimary).length,1);
  assert.equal(catalog.declaredProfile[0].code,'46.19-2-00');
  assert.equal(catalog.declaredProfile.at(-1)?.code,'50.30-1-01');

  const input={action:'applyDeclaredProfile',commandKey:randomUUID()};
  assert.equal((await registerCnaes(request(outsider,path,input),route)).status,404);
  assert.equal((await registerCnaes(request(operator,path,input),route)).status,403);
  assert.equal((await registerCnaes(request(owner,path,input),route)).status,201);
  assert.equal((await registerCnaes(request(owner,path,input),route)).status,200);
  assert.equal((await registerCnaes(request(owner,path,{
    action:'applyDeclaredProfile',commandKey:randomUUID(),
  }),route)).status,409);

  const afterRead=await listCnaes(request(operator,path),route);
  assert.equal(afterRead.status,200);
  const linked=await afterRead.json() as {items:Array<{code:string;isPrimary:boolean}>};
  assert.equal(linked.items.length,49);
  assert.equal(linked.items.filter(x=>x.isPrimary).length,1);
  assert.equal(linked.items[0].code,'46.19-2-00');
  const saved=await pool.query(
    'SELECT COUNT(*)::integer AS count FROM enterprise_legal_entity_cnaes WHERE tenant_id=$1 AND legal_entity_id=$2',
    [tenantId,entityId],
  );
  assert.equal(saved.rows[0].count,49);
  const events=await pool.query(
    "SELECT COUNT(*)::integer AS count FROM enterprise_permission_events WHERE tenant_id=$1 AND action='legal_entity.cnaes.registered'",
    [tenantId],
  );
  assert.equal(events.rows[0].count,1);
});
