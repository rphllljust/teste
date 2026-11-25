import test,{after,before} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {closeDatabase} from '../../db/raw';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {POST as createTenant} from '../../app/api/enterprise/tenants/route';
import {GET as members,POST as command} from '../../app/api/enterprise/tenants/[id]/members/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)throw new Error('Requires disposable PostgreSQL and NODE_ENV=test');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3});
const owner=randomUUID(),admin=randomUUID(),operator=randomUUID(),stranger=randomUUID(),tenantId=randomUUID();
const path='/api/enterprise/tenants/'+tenantId+'/members';
const route={params:Promise.resolve({id:tenantId})};
const request=(who:string,url:string,body?:unknown)=>setTestIdentity(new Request('http://localhost'+url,{
 method:body===undefined?'GET':'POST',headers:{'content-type':'application/json'},
 ...(body===undefined?{}:{body:JSON.stringify(body)}),
}),who);

before(async()=>{
 const created=await createTenant(request(owner,'/api/enterprise/tenants',{
   id:tenantId,commandKey:randomUUID(),slug:'members-'+tenantId.slice(0,8),name:'Grupo Membership CI',
 }));
 assert.equal(created.status,201);
});
after(async()=>{
 await pool.query('DELETE FROM enterprise_permission_events WHERE tenant_id=$1',[tenantId]);
 await pool.query('DELETE FROM enterprise_tenant_memberships WHERE tenant_id=$1',[tenantId]);
 await pool.query('DELETE FROM enterprise_tenants WHERE id=$1',[tenantId]);
 await pool.query("DELETE FROM business_commands WHERE entity_id=$1 AND entity_type IN ('enterpriseTenant','enterpriseMembership')",[tenantId]);
 await closeDatabase(); await pool.end();
});

test('only tenant owner can provision, grant and revoke; idempotency and isolation are durable',async()=>{
 const provisionAdmin={commandKey:randomUUID(),action:'provision',actorId:admin,role:'admin'};
 assert.equal((await command(request(stranger,path,provisionAdmin),route)).status,404);
 assert.equal((await command(request(owner,path,{...provisionAdmin,actorId:owner}),route)).status,409);
 const created=await command(request(owner,path,provisionAdmin),route);
 assert.equal(created.status,201,JSON.stringify(await created.clone().json()));
 assert.equal((await command(request(owner,path,provisionAdmin),route)).status,200);
 assert.equal((await command(request(owner,path,{...provisionAdmin,role:'operator'}),route)).status,409);
 const provisionOperator={commandKey:randomUUID(),action:'provision',actorId:operator,role:'operator'};
 assert.equal((await command(request(admin,path,provisionOperator),route)).status,403);
 assert.equal((await command(request(owner,path,{...provisionOperator,role:'owner'}),route)).status,400);
 assert.equal((await command(request(owner,path,provisionOperator),route)).status,201);
 const roster=await members(request(admin,path),route);
 assert.equal(roster.status,200);
 assert.equal((await roster.json() as {items:Array<{actorId:string}>}).items.length,3);
 assert.equal((await members(request(operator,path),route)).status,403);
 assert.equal((await members(request(stranger,path),route)).status,404);
 const revoke={commandKey:randomUUID(),action:'deactivate',actorId:operator};
 assert.equal((await command(request(admin,path,revoke),route)).status,403);
 assert.equal((await command(request(owner,path,revoke),route)).status,201);
 assert.equal((await command(request(owner,path,revoke),route)).status,200);
 assert.equal((await command(request(owner,path,{...provisionOperator,commandKey:randomUUID()}),route)).status,409);
 const status=await pool.query(
  'SELECT role,status FROM enterprise_tenant_memberships WHERE tenant_id=$1 AND actor_id=$2',[tenantId,operator],
 );
 assert.deepEqual(status.rows,[{role:'operator',status:'inactive'}]);
 const events=await pool.query(
   "SELECT action FROM enterprise_permission_events WHERE tenant_id=$1 AND action LIKE 'membership.%' ORDER BY created_at",[tenantId],
 );
 assert.deepEqual(events.rows.map(x=>x.action).sort(),
   ['membership.provisioned','membership.provisioned','membership.deactivated'].sort());
});
