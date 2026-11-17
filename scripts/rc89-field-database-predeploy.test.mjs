import test from 'node:test';
import assert from 'node:assert/strict';
import { assessRC89FieldIdentity, verifyRC89FieldDatabase } from './rc89-field-database-predeploy.mjs';

const bucket = 'rc84-nextcrm-isolated-objects-z0c7g4';
const env = Object.freeze({
  RAILWAY_PROJECT_ID:'0835d357-6037-42e6-a534-6456422e1cf3',
  RAILWAY_ENVIRONMENT_ID:'c241a855-68b7-4d75-a722-b6a42c8581e9',
  RAILWAY_ENVIRONMENT_NAME:'staging',
  RAILWAY_SERVICE_ID:'fed95ca7-f373-4e6a-983f-2f591f26672e',
  RAILWAY_SERVICE_NAME:'cisne-rc85-ephemeral-erp',
  NODE_ENV:'production', PORT:'8080',
  CISNE_RAILWAY_WORKER_BINDINGS:'restricted',CLOUDFLARE_INCLUDE_PROCESS_ENV:'false',
  CISNE_STAGING_ACCESS_MODE:'private',CISNE_STAGING_READ_ONLY:'true',
  CISNE_STAGING_ACTOR_ID:'synthetic-actor-rc89',
  CISNE_STAGING_SESSION_SECRET:'synthetic-session-secret-isolated-testing-20261117',
  CISNE_RC84_RAILWAY_BUCKET_MODE:'true',
  CISNE_NEXTCRM_PRIVATE_ORIGIN:'http://nextcrm-rc84-isolated-web.railway.internal:3000',
  CISNE_NEXTCRM_INSTANCE_KEY:'rc84_isolated_hml',
  CISNE_NEXTCRM_BRIDGE_SECRET:'b'.repeat(64),
  CISNE_NEXTCRM_MINIO_BUCKET:bucket,
  CISNE_NEXTCRM_MINIO_PUBLIC_ORIGIN:'https://' + bucket + '.t3.storageapi.dev',
  DATABASE_URL:'postgresql://cisne_rc89_field_app:' + 'a'.repeat(64) +
    '@cisne-rc75-postgres-uat.railway.internal:5432/cisne_rc89_field',
});

const goodRow={
  field_database:true,field_role:true,field_owner:true,
  postgres18:true,primary:true,role_limited:true,
};
test('verified persisted PG18 database identity passes with no schema assumption',()=>{
  assert.deepEqual(assessRC89FieldIdentity(goodRow),[]);
});
for(const [key,field] of [
  ['DB_NAME','field_database'],['DB_ROLE','field_role'],
  ['DB_OWNER','field_owner'],['DB_POSTGRES18','postgres18'],
  ['DB_PRIMARY','primary'],['DB_LEAST_PRIVILEGED','role_limited'],
]){
  test('fail closed if '+field+' is wrong or unavailable',()=>{
    for(const value of [false,undefined,null,'true']){
      assert.ok(assessRC89FieldIdentity({...goodRow,[field]:value}).includes(key));
    }
  });
}
test('null or absent SQL row refuses approval',()=>{
  assert.equal(assessRC89FieldIdentity(null).length,6);
});
test('queries only the strict identity SELECT, in read-only connection',async()=>{
  let connected=false,closed=false;
  class FakeClient{
    constructor(config){
      assert.equal(config.options,'-c default_transaction_read_only=on -c statement_timeout=3500');
      assert.equal(config.connectionTimeoutMillis,4500);
      assert.equal(config.query_timeout,4500);
      assert.equal(config.connectionString,env.DATABASE_URL);
    }
    async connect(){connected=true;}
    async query(query){
      assert.match(query.trim(),/^SELECT current_database\(\)/);
      assert.doesNotMatch(query,/\bCREATE\b|\bDROP\b|\bINSERT\b|\bALTER\b/i);
      return {rows:[goodRow]};
    }
    async end(){closed=true;}
  }
  const outcome=await verifyRC89FieldDatabase(env,FakeClient);
  assert.deepEqual(outcome,[]);
  assert.equal(connected,true);
  assert.equal(closed,true);
});
test('rejects wrong Railway environment BEFORE connecting',async()=>{
  class CannotConnect{constructor(){throw Error('MUST NOT CONNECT');}}
  const out=await verifyRC89FieldDatabase({...env,RAILWAY_ENVIRONMENT_NAME:'production'},CannotConnect);
  assert.ok(out.includes('CONFIG_RAILWAY_ENVIRONMENT_NAME'));
  assert.ok(!out.includes('DB_CONNECT_OR_READ_FAILED'));
});
test('wrong original ephemeral database connection rejected before connecting',async()=>{
  class CannotConnect{constructor(){throw Error('MUST NOT CONNECT');}}
  const out=await verifyRC89FieldDatabase({...env,DATABASE_URL:'postgresql://postgres:bad@cisne-rc85-ephemeral-pg.railway.internal:5432/cisne_rc85'},CannotConnect);
  assert.ok(out.includes('CONFIG_DATABASE_URL'));
});
test('SQL connection failure is redacted and marked NO-GO',async()=>{
  const secret='synthetic-sensitive-secret-not-to-log';
  class BadClient{
    async connect(){throw Error(secret);}
    async end(){}
  }
  const out=await verifyRC89FieldDatabase(env,BadClient);
  assert.deepEqual(out,['DB_CONNECT_OR_READ_FAILED']);
  assert.ok(!JSON.stringify(out).includes(secret));
});
test('non-single SQL result is denied and connections closed',async()=>{
  let closed=false;
  class BadClient{
    async connect(){}
    async query(){return {rows:[goodRow,goodRow]};}
    async end(){closed=true;}
  }
  assert.deepEqual(await verifyRC89FieldDatabase(env,BadClient),['DB_RESULT_INVALID']);
  assert.equal(closed,true);
});
test('failed close is not approved',async()=>{
  class BadClient{
    async connect(){}
    async query(){return {rows:[goodRow]};}
    async end(){throw Error('should never be displayed');}
  }
  assert.deepEqual(await verifyRC89FieldDatabase(env,BadClient),['DB_CLIENT_CLOSE_FAILED']);
});
