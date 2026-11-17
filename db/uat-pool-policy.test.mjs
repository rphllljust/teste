import test from 'node:test';
import assert from 'node:assert/strict';
import { issueStagingSession, CISNE_STAGING_COOKIE } from '../lib/api/staging-session.mjs';
import { issueRC95UatToken } from '../lib/api/staging-uat-mutation.mjs';
import { stagingBoundaryError } from '../lib/api/staging-access.mjs';
import { rc98PgPoolMode } from './uat-pool-policy.mjs';

const actor='rc98-specific-test-actor';
const secret='rc98-scope-isolated-hmac-cookie-secret-over-32-bytes';
const env=()=>({
  RAILWAY_PROJECT_ID:'0835d357-6037-42e6-a534-6456422e1cf3',
  RAILWAY_ENVIRONMENT_ID:'c241a855-68b7-4d75-a722-b6a42c8581e9',
  RAILWAY_ENVIRONMENT_NAME:'staging',
  RAILWAY_SERVICE_ID:'fed95ca7-f373-4e6a-983f-2f591f26672e',
  RAILWAY_SERVICE_NAME:'cisne-rc85-ephemeral-erp',
  CISNE_STAGING_ACCESS_MODE:'private',
  CISNE_STAGING_READ_ONLY:'true',
  CISNE_STAGING_ACTOR_ID:actor,
  CISNE_STAGING_SESSION_SECRET:secret,
  CISNE_RC95_UAT_ENABLED:'true',
  CISNE_RC95_UAT_ACTOR_ID:actor,
  CISNE_RC95_UAT_SIGNING_KEY:'b'.repeat(64),
  CISNE_RC95_UAT_UNTIL_MS:String(Date.now()+180000),
});
const incoming=(e,sign=true)=>{
  const url='http://cisne-rc85-ephemeral-erp.railway.internal:8080/api/orders';
  const session=issueStagingSession(actor,e.CISNE_STAGING_SESSION_SECRET);
  const request=new Request(url,{method:'POST',headers:{cookie:CISNE_STAGING_COOKIE+'='+session,
    'content-type':'application/json'}});
  const token=sign?issueRC95UatToken(request,actor,e.CISNE_RC95_UAT_SIGNING_KEY):'';
  return new Request(url,{method:'POST',headers:{...Object.fromEntries(request.headers),
    'x-cisne-rc95-uat':token}});
};

test('default staging readonly remains SQL readonly even with UAT variables armed',()=>{
  const e=env();
  const decision=rc98PgPoolMode(e);
  assert.deepEqual(decision,{mode:'read-only',options:'-c default_transaction_read_only=on',max:undefined});
  assert.equal(stagingBoundaryError(incoming(e,false),e)?.status,403);
  assert.equal(rc98PgPoolMode(e).mode,'read-only');
});

test('only fully validated RC95 signed synthetic request can reach separate one-client writer pool',()=>{
  const e=env();
  assert.equal(stagingBoundaryError(incoming(e),e),null);
  assert.deepEqual(rc98PgPoolMode(e),{
    mode:'synthetic-write',options:'-c default_transaction_read_only=off',max:1});
  assert.equal(rc98PgPoolMode({...e,CISNE_RC95_UAT_ENABLED:'false'}).mode,'read-only');
  assert.equal(rc98PgPoolMode({...e,RAILWAY_ENVIRONMENT_ID:'production'}).mode,'read-only');
});

test('signed client cannot use write capability for next unsigned read-only request',()=>{
  const e=env();
  stagingBoundaryError(incoming(e),e);
  assert.equal(rc98PgPoolMode(e).mode,'synthetic-write');
  const get=new Request('http://field.railway.internal:8080/api/orders',{
    method:'GET',headers:{cookie:CISNE_STAGING_COOKIE+'='+
      issueStagingSession(actor,e.CISNE_STAGING_SESSION_SECRET)}});
  assert.equal(stagingBoundaryError(get,e),null);
  assert.equal(rc98PgPoolMode(e).mode,'read-only');
});

test('production and nonstaging normal mode never use RC98 temporary write pool',()=>{
  const e=env();
  stagingBoundaryError(incoming(e),e);
  assert.equal(rc98PgPoolMode({...e,RAILWAY_ENVIRONMENT_NAME:'production'}).mode,'normal');
  assert.equal(rc98PgPoolMode({...e,CISNE_STAGING_READ_ONLY:'false'}).mode,'normal');
});
