import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {closeDatabase} from '../../db/raw';
import {GET as readinessGET} from '../../app/api/integrations/nextcrm/readiness/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
  throw Error('NEXTCRM_READINESS_NO_GO: disposable CI database required');
const dbUrl=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(dbUrl.hostname)||
  !['/cisne_test','/cisne_ci'].includes(dbUrl.pathname)||dbUrl.port!=='5432')
  throw Error('NEXTCRM_READINESS_NO_GO: refusing non-disposable PostgreSQL');
const instance='cisne-readiness-ci',owner=randomUUID(),foreign=randomUUID();
const ownerClient=randomUUID(),foreignClient=randomUUID();
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});
const keys=['RAILWAY_ENVIRONMENT_NAME','CISNE_NEXTCRM_PUBLIC_URL',
  'CISNE_NEXTCRM_BRIDGE_SECRET','CISNE_NEXTCRM_INSTANCE_KEY'] as const;
const prior=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
Object.assign(process.env,{
  RAILWAY_ENVIRONMENT_NAME:'staging',
  CISNE_NEXTCRM_PUBLIC_URL:'https://nextcrm-gateway-staging.up.railway.app',
  CISNE_NEXTCRM_BRIDGE_SECRET:'a'.repeat(64),
  CISNE_NEXTCRM_INSTANCE_KEY:instance,
});
const request=(actor:string)=>setTestIdentity(
  new Request('http://localhost/api/integrations/nextcrm/readiness'),actor);
async function status(actor:string){
  const response=await readinessGET(request(actor));
  const data=await response.json() as {
    ready:boolean;schemaApplied:boolean;activeIdentityMappings:number;
    activeAccountMappings:number;blockers:string[];
  };
  assert.equal(response.status,200,JSON.stringify(data));
  return data;
}
after(async()=>{
  try{
    await pool.query('DELETE FROM nextcrm_erp_client_account_mappings WHERE erp_client_id=ANY($1::text[])',[[ownerClient,foreignClient]]);
    await pool.query('DELETE FROM nextcrm_erp_identity_mappings WHERE erp_actor_id=ANY($1::text[])',[[owner,foreign]]);
    await pool.query('DELETE FROM clients WHERE id=ANY($1::text[])',[[ownerClient,foreignClient]]);
  }finally{
    await closeDatabase();await pool.end();
    for(const key of keys){
      const old=prior[key];
      if(old===undefined)delete process.env[key];else process.env[key]=old;
    }
  }
});

test('NextCRM readiness never counts another operator or another instance as user approval',async()=>{
  const noMapping=await status(owner);
  assert.equal(noMapping.schemaApplied,true);
  assert.equal(noMapping.ready,false);
  assert.equal(noMapping.activeIdentityMappings,0);
  assert.equal(noMapping.activeAccountMappings,0);
  assert.ok(noMapping.blockers.includes('IDENTITY_MAPPING_REQUIRED'));
  assert.ok(noMapping.blockers.includes('ACCOUNT_MAPPING_REQUIRED'));

  const now=new Date().toISOString();
  await pool.query(
    'INSERT INTO clients(id,owner_id,legal_name,created_at,updated_at) VALUES($1,$2,$3,$4,$4),($5,$6,$7,$4,$4)',
    [ownerClient,owner,'Cliente ERP sintético',now,foreignClient,foreign,'Cliente CRM sintético'],
  );
  await pool.query(
    "INSERT INTO nextcrm_erp_identity_mappings(erp_actor_id,nextcrm_subject_id,instance_key,verified_source,verified_by,verified_at,active) VALUES($1,$2,$3,'ci-isolated-check','ci-reviewer',now(),true)",
    [foreign,randomUUID(),instance],
  );
  await pool.query(
    "INSERT INTO nextcrm_erp_client_account_mappings(erp_client_id,erp_owner_id,nextcrm_account_id,instance_key,verified_source,verified_by,verified_at,active) VALUES($1,$2,$3,$4,'ci-isolated-check','ci-reviewer',now(),true)",
    [foreignClient,foreign,randomUUID(),instance],
  );
  const isolated=await status(owner);
  assert.equal(isolated.ready,false,'Another user mapping must not create a false GO');
  assert.deepEqual([isolated.activeIdentityMappings,isolated.activeAccountMappings],[0,0]);
  const approvedForeign=await status(foreign);
  assert.equal(approvedForeign.ready,true);
  assert.deepEqual([approvedForeign.activeIdentityMappings,approvedForeign.activeAccountMappings],[1,1]);

  await pool.query(
    "INSERT INTO nextcrm_erp_identity_mappings(erp_actor_id,nextcrm_subject_id,instance_key,verified_source,verified_by,verified_at,active) VALUES($1,$2,$3,'ci-isolated-check','ci-reviewer',now(),true)",
    [owner,randomUUID(),instance],
  );
  await pool.query(
    "INSERT INTO nextcrm_erp_client_account_mappings(erp_client_id,erp_owner_id,nextcrm_account_id,instance_key,verified_source,verified_by,verified_at,active) VALUES($1,$2,$3,$4,'ci-isolated-check','ci-reviewer',now(),true)",
    [ownerClient,owner,randomUUID(),instance],
  );
  assert.equal((await status(owner)).ready,true);
  await pool.query('UPDATE nextcrm_erp_client_account_mappings SET active=false WHERE erp_client_id=$1',[ownerClient]);
  const disabled=await status(owner);
  assert.equal(disabled.ready,false);
  assert.deepEqual([disabled.activeIdentityMappings,disabled.activeAccountMappings],[1,0]);

  process.env.CISNE_NEXTCRM_INSTANCE_KEY='unmapped-instance-ci';
  const wrongInstance=await status(foreign);
  assert.equal(wrongInstance.ready,false);
  assert.deepEqual([wrongInstance.activeIdentityMappings,wrongInstance.activeAccountMappings],[0,0]);
});
