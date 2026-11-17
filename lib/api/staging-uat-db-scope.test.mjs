import test from 'node:test';
import assert from 'node:assert/strict';
import { issueStagingSession, CISNE_STAGING_COOKIE } from './staging-session.mjs';
import { issueRC95UatToken } from './staging-uat-mutation.mjs';
import { stagingBoundaryError } from './staging-access.mjs';
import { withRC98SignedDbScope, rc98UatWritePoolAllowed } from './staging-uat-db-scope.mjs';

const actor='rc98-synthetic-actor';
const secret='rc98-synthetic-staging-session-secret-over-32-bytes';
function config() {
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
    CISNE_RC95_UAT_UNTIL_MS:String(Date.now()+180000),
  };
}
function makeRequest(env,{path='/api/orders',method='POST',signed=true}={}) {
  const cookie=issueStagingSession(actor,secret);
  const url='http://field.railway.internal:8080'+path;
  const r=new Request(url,{method,headers:{
    cookie:CISNE_STAGING_COOKIE+'='+cookie,
    'content-type':'application/json',
  }});
  if(!signed)return r;
  const signature=issueRC95UatToken(r,actor,env.CISNE_RC95_UAT_SIGNING_KEY);
  return new Request(url,{method,headers:{
    ...Object.fromEntries(r.headers),'x-cisne-rc95-uat':signature,
  }});
}
test('signed POST acquires only a bounded request-local capability',()=>{
  const env=config(),req=makeRequest(env);
  const inside=withRC98SignedDbScope(req,()=>{
    assert.equal(stagingBoundaryError(req,env),null);
    return rc98UatWritePoolAllowed(env);
  },env);
  assert.equal(inside,true);
  assert.equal(rc98UatWritePoolAllowed(env),false,'run() must not leak to caller');
});

test('unsigned and non-POST calls remain SQL readonly despite armed environment',()=>{
  const env=config();
  for(const item of [{signed:false},{method:'GET',signed:false},
    {path:'/api/finance/transfers'},{path:'/api/orders?inject=true'}]){
    const req=makeRequest(env,item);
    const result=withRC98SignedDbScope(req,()=>{
      assert.ok(stagingBoundaryError(req,env)!==null || req.method==='GET');
      return rc98UatWritePoolAllowed(env);
    },env);
    assert.equal(result,false);
  }
});

test('production, wrong target, disabled flag, expired and altered signature refuse writer scope',()=>{
  const env=config(),req=makeRequest(env);
  for(const changed of [
    {RAILWAY_ENVIRONMENT_NAME:'production'},
    {RAILWAY_PROJECT_ID:'other'},
    {RAILWAY_SERVICE_ID:'other'},
    {CISNE_STAGING_READ_ONLY:'false'},
    {CISNE_RC95_UAT_ENABLED:'false'},
    {CISNE_RC95_UAT_UNTIL_MS:String(Date.now()-100)},
  ]){
    const bad={...env,...changed};
    assert.equal(withRC98SignedDbScope(req,()=>rc98UatWritePoolAllowed(bad),bad),false);
  }
});

test('request deadlines revoke an already-entered capability',()=>{
  const env=config(),req=makeRequest(env);
  withRC98SignedDbScope(req,()=>{
    assert.equal(rc98UatWritePoolAllowed(env),true);
    assert.equal(rc98UatWritePoolAllowed(env,Date.now()+11000),false);
    assert.equal(rc98UatWritePoolAllowed({...env,CISNE_RC95_UAT_ENABLED:'false'}),false);
  },env);
});

test('workerd-compatible run() isolates interleaved concurrent signed and unsigned calls',async()=>{
  const env=config();
  const cases=Array.from({length:30},(_,i)=>i%2===0);
  const results=await Promise.all(cases.map(async signed=>{
    const req=makeRequest(env,{signed});
    return withRC98SignedDbScope(req,async()=>{
      const error=stagingBoundaryError(req,env);
      await new Promise(resolve=>setImmediate(resolve));
      await Promise.resolve();
      return {signed,approved:error===null,writer:rc98UatWritePoolAllowed(env)};
    },env);
  }));
  assert.equal(results.length,30);
  for(const r of results){
    assert.equal(r.approved,r.signed);
    assert.equal(r.writer,r.signed);
  }
  assert.equal(rc98UatWritePoolAllowed(env),false);
});
