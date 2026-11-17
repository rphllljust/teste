import test from 'node:test';
import assert from 'node:assert/strict';
import { issueStagingSession, CISNE_STAGING_COOKIE } from './staging-session.mjs';
import { issueRC95UatToken } from './staging-uat-mutation.mjs';
import { stagingBoundaryError } from './staging-access.mjs';
import { rc98UatWritePoolAllowed } from './staging-uat-db-scope.mjs';

const actor = 'rc98-synthetic-actor';
const secret = 'rc98-synthetic-staging-session-secret-over-32-bytes';
function config(now=Date.now()) {
  return {
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
    CISNE_RC95_UAT_SIGNING_KEY:'a'.repeat(64),
    CISNE_RC95_UAT_UNTIL_MS:String(now+180_000),
  };
}
function makeRequest(env,{path='/api/orders',method='POST',signed=true}={}) {
  const cookie=issueStagingSession(actor,secret);
  const request=new Request('http://field.railway.internal:8080'+path,{
    method,headers:{cookie:CISNE_STAGING_COOKIE+'='+cookie,
      'content-type':'application/json'},
  });
  if(!signed)return request;
  const sig=issueRC95UatToken(request,actor,env.CISNE_RC95_UAT_SIGNING_KEY);
  return new Request(request.url,{method,headers:{
    cookie:CISNE_STAGING_COOKIE+'='+cookie,
    'content-type':'application/json','x-cisne-rc95-uat':sig,
  }});
}

test('an authorized signed POST may use the separate UAT write connection',()=>{
  const env=config();
  assert.equal(stagingBoundaryError(makeRequest(env),env),null);
  assert.equal(rc98UatWritePoolAllowed(env),true);
  assert.equal(rc98UatWritePoolAllowed(env,Date.now()+11_000),false);
});

test('unsigned, GET, expired, wrong-service and production requests stay read-only',()=>{
  const env=config();
  assert.equal(stagingBoundaryError(makeRequest(env,{signed:false}),env)?.status,403);
  assert.equal(rc98UatWritePoolAllowed(env),false);
  assert.equal(stagingBoundaryError(makeRequest(env,{method:'GET',signed:false}),env),null);
  assert.equal(rc98UatWritePoolAllowed(env),false);
  assert.equal(stagingBoundaryError(makeRequest(env),env),null);
  assert.equal(rc98UatWritePoolAllowed({...env,RAILWAY_ENVIRONMENT_NAME:'production'}),false);
  assert.equal(rc98UatWritePoolAllowed({...env,RAILWAY_SERVICE_ID:'unexpected'}),false);
  assert.equal(rc98UatWritePoolAllowed({...env,CISNE_RC95_UAT_UNTIL_MS:String(Date.now()-100)}),false);
  assert.equal(rc98UatWritePoolAllowed({...env,CISNE_RC95_UAT_ENABLED:'false'}),false);
});

test('only allowlisted POST can establish DB write capability',()=>{
  const env=config();
  const attack=makeRequest(env,{path:'/api/finance/transfers'});
  assert.equal(stagingBoundaryError(attack,env)?.status,403);
  assert.equal(rc98UatWritePoolAllowed(env),false);
});

test('concurrent signed and unsigned requests receive separate async DB scopes',async()=>{
  const env=config();
  const outcomes=await Promise.all([
    new Promise(resolve=>setImmediate(async()=>{
      assert.equal(stagingBoundaryError(makeRequest(env),env),null);
      await Promise.resolve();
      resolve(rc98UatWritePoolAllowed(env));
    })),
    new Promise(resolve=>setImmediate(async()=>{
      assert.equal(stagingBoundaryError(makeRequest(env,{signed:false}),env)?.status,403);
      await Promise.resolve();
      resolve(rc98UatWritePoolAllowed(env));
    })),
  ]);
  assert.deepEqual(outcomes,[true,false]);
});

test('a completed request cannot grant writer capacity outside a new signed request scope',()=>{
  const env=config();
  stagingBoundaryError(makeRequest(env),env);
  assert.equal(rc98UatWritePoolAllowed(env),true);
  stagingBoundaryError(makeRequest(env,{method:'GET',signed:false}),env);
  assert.equal(rc98UatWritePoolAllowed(env),false);
});
