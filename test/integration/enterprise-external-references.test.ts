import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {closeDatabase} from '../../db/raw';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {POST as createTenant} from '../../app/api/enterprise/tenants/route';
import {POST as createEntity} from '../../app/api/enterprise/tenants/[id]/legal-entities/route';
import {POST as createReference,GET as listReferences} from '../../app/api/enterprise/tenants/[id]/external-references/route';
import {POST as reviewReference} from '../../app/api/enterprise/tenants/[id]/external-references/[referenceId]/commands/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)throw new Error('External reference integration requires disposable PostgreSQL');
const u=new URL(process.env.DATABASE_URL);
if(!['127.0.0.1','localhost'].includes(u.hostname)||!['/cisne_test','/cisne_ci'].includes(u.pathname))throw new Error('NO-GO: external reference integration refuses non-disposable database');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:4});
const actor=randomUUID(),outsider=randomUUID(),tenantId=randomUUID(),entityId=randomUUID(),referenceId=randomUUID(),externalEntityId=randomUUID();
const path='/api/enterprise/tenants/'+tenantId;
const route={params:Promise.resolve({id:tenantId})};
function req(who:string,url:string,body:unknown){return setTestIdentity(new Request('http://localhost'+url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),who);}
async function cleanup(){
 await pool.query('DELETE FROM business_commands WHERE actor_id=ANY($1::text[])',[ [actor,outsider] ]);
 await pool.query('DELETE FROM enterprise_external_reference_events WHERE tenant_id=$1',[tenantId]);
 await pool.query('DELETE FROM enterprise_external_references WHERE tenant_id=$1',[tenantId]);
 await pool.query('DELETE FROM enterprise_permission_events WHERE tenant_id=$1',[tenantId]);
 await pool.query('DELETE FROM enterprise_legal_entities WHERE tenant_id=$1',[tenantId]);
 await pool.query('DELETE FROM enterprise_tenant_memberships WHERE tenant_id=$1',[tenantId]);
 await pool.query('DELETE FROM enterprise_tenants WHERE id=$1',[tenantId]);
}
after(async()=>{await cleanup();await closeDatabase();await pool.end();});

test('external reference persists pending, is tenant isolated, and review is idempotent/audited',async()=>{
 await cleanup();
 const createdTenant=await createTenant(req(actor,'/api/enterprise/tenants',{id:tenantId,commandKey:randomUUID(),slug:'hml-'+tenantId.slice(0,8),name:'Tenant CI Integracao'}));
 assert.equal(createdTenant.status,201,JSON.stringify(await createdTenant.clone().json()));
 const entity=await createEntity(req(actor,path+'/legal-entities',{id:entityId,commandKey:randomUUID(),code:'MATRIZ',name:'Matriz de Homologacao',taxId:'12345678901234'}),route);
 assert.equal(entity.status,201,JSON.stringify(await entity.clone().json()));
 const payload={id:referenceId,commandKey:randomUUID(),legalEntityId:entityId,entityType:'legal_entity',entityId:entityId,systemKey:'cnpj-biz',externalId:'11897171000181',sourceUrl:'https://cnpj.biz/11897171000181',sourceLabel:'Consulta cadastral informada pelo usuário',ownerDisplayName:'Abrahim Jabour Junior',taxId:'11897171000181'};
 const created=await createReference(req(actor,path+'/external-references',payload),route);
 assert.equal(created.status,201,JSON.stringify(await created.clone().json()));
 assert.equal((await created.json()).status,'pending_review');
 assert.equal((await createReference(req(outsider,path+'/external-references',{...payload,id:randomUUID(),commandKey:randomUUID()}),route)).status,404);
 const listing=await listReferences(setTestIdentity(new Request('http://localhost'+path+'/external-references'),actor),route);
 assert.equal(listing.status,200);
 const rows=(await listing.json()).items;
 assert.equal(rows.length,1);assert.equal(rows[0].id,referenceId);assert.equal(rows[0].taxId,'11897171000181');
 const action={commandKey:randomUUID(),action:'verify',expectedVersion:1,note:'Conferido em base descartável de CI.'};
 const reviewRoute={params:Promise.resolve({id:tenantId,referenceId})};
 const reviewed=await reviewReference(req(actor,path+'/external-references/'+referenceId+'/commands',action),reviewRoute);
 assert.equal(reviewed.status,200,JSON.stringify(await reviewed.clone().json()));
 assert.equal((await reviewed.json()).status,'verified');
 assert.equal((await reviewReference(req(actor,path+'/external-references/'+referenceId+'/commands',action),reviewRoute)).status,200);
 assert.equal((await reviewReference(req(actor,path+'/external-references/'+referenceId+'/commands',{...action,commandKey:randomUUID()}),reviewRoute)).status,409);
 assert.equal((await reviewReference(req(outsider,path+'/external-references/'+referenceId+'/commands',{...action,commandKey:randomUUID()}),reviewRoute)).status,404);
 const persisted=await pool.query('SELECT status,reviewed_by,row_version FROM enterprise_external_references WHERE id=$1',[referenceId]);
 assert.deepEqual(persisted.rows[0],{status:'verified',reviewed_by:actor,row_version:2});
 const events=await pool.query('SELECT action,to_status FROM enterprise_external_reference_events WHERE reference_id=$1 ORDER BY created_at,id',[referenceId]);
 assert.deepEqual(events.rows,[{action:'verified',to_status:'verified'}]);
});
