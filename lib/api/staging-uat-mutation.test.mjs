import test from 'node:test';
import assert from 'node:assert/strict';
import { issueStagingSession, CISNE_STAGING_COOKIE } from './staging-session.mjs';
import { stagingBoundaryError } from './staging-access.mjs';
import { issueRC95UatToken, isApprovedRC95UatMutation } from './staging-uat-mutation.mjs';

const now = Date.parse('2026-11-17T20:00:00Z');
const actor = 'rc95-synthetic-staging-actor';
const env = Object.freeze({
  RAILWAY_PROJECT_ID:'0835d357-6037-42e6-a534-6456422e1cf3',
  RAILWAY_ENVIRONMENT_ID:'c241a855-68b7-4d75-a722-b6a42c8581e9',
  RAILWAY_ENVIRONMENT_NAME:'staging',
  RAILWAY_SERVICE_ID:'fed95ca7-f373-4e6a-983f-2f591f26672e',
  RAILWAY_SERVICE_NAME:'cisne-rc85-ephemeral-erp',
  CISNE_STAGING_READ_ONLY:'true',
  CISNE_STAGING_ACCESS_MODE:'private',
  CISNE_STAGING_ACTOR_ID:actor,
  CISNE_STAGING_SESSION_SECRET:'synthetic-session-hmac-secret-with-32-bytes-or-more',
  CISNE_RC95_UAT_ENABLED:'true',
  CISNE_RC95_UAT_ACTOR_ID:actor,
  CISNE_RC95_UAT_SIGNING_KEY:'9'.repeat(64),
  CISNE_RC95_UAT_UNTIL_MS:String(now+8*60*1000),
});
const signedRequest=(path='/api/orders',mode={})=>{
  const method=mode.method??'POST';
  const cookie=issueStagingSession(mode.actor??actor,env.CISNE_STAGING_SESSION_SECRET,now);
  const url='http://cisne-rc85-ephemeral-erp.railway.internal:8080'+path;
  const seed=new Request(url,{method,headers:{'content-type':'application/json',
    cookie:CISNE_STAGING_COOKIE+'='+cookie}});
  const signature=issueRC95UatToken(seed,mode.actor??actor,env.CISNE_RC95_UAT_SIGNING_KEY,mode.time??now);
  return new Request(url,{method,headers:{
    'content-type':mode.contentType??'application/json',
    cookie:mode.noCookie?'':CISNE_STAGING_COOKIE+'='+cookie,
    'x-cisne-rc95-uat':mode.token??signature,
  }});
};

test('permits a signed synthetic mutation only inside the exact staging window',()=>{
  const request=signedRequest('/api/orders');
  assert.equal(isApprovedRC95UatMutation(request,env,now),true);
  // stagingBoundaryError uses Date.now, so test it with a relative window.
  const liveEnv={...env,CISNE_RC95_UAT_UNTIL_MS:String(Date.now()+120000)};
  const liveToken=issueStagingSession(actor,env.CISNE_STAGING_SESSION_SECRET);
  const raw=new Request('http://cisne-rc85-ephemeral-erp.railway.internal:8080/api/orders',{
    method:'POST',headers:{cookie:CISNE_STAGING_COOKIE+'='+liveToken,
      'content-type':'application/json'},
  });
  const liveSig=issueRC95UatToken(raw,actor,env.CISNE_RC95_UAT_SIGNING_KEY);
  const liveRequest=new Request(raw.url,{method:'POST',headers:{...Object.fromEntries(raw.headers),
    'x-cisne-rc95-uat':liveSig}});
  assert.equal(stagingBoundaryError(liveRequest,liveEnv),null);
});

const deny=[
  ['disarmed', {CISNE_RC95_UAT_ENABLED:'false'}],
  ['wrong project', {RAILWAY_PROJECT_ID:'other'}],
  ['wrong environment ID', {RAILWAY_ENVIRONMENT_ID:'production'}],
  ['production environment', {RAILWAY_ENVIRONMENT_NAME:'production'}],
  ['wrong service', {RAILWAY_SERVICE_ID:'other'}],
  ['wrong service name', {RAILWAY_SERVICE_NAME:'billing'}],
  ['public staging mode', {CISNE_STAGING_ACCESS_MODE:'public'}],
  ['readonly off', {CISNE_STAGING_READ_ONLY:'false'}],
  ['different signed actor', {CISNE_RC95_UAT_ACTOR_ID:'stranger'}],
  ['short signing key', {CISNE_RC95_UAT_SIGNING_KEY:'weak'}],
  ['missing signing key', {CISNE_RC95_UAT_SIGNING_KEY:undefined}],
  ['expired permit', {CISNE_RC95_UAT_UNTIL_MS:String(now-1)}],
  ['too-long permit', {CISNE_RC95_UAT_UNTIL_MS:String(now+11*60*1000)}],
  ['garbled expiry', {CISNE_RC95_UAT_UNTIL_MS:'NaN'}],
];
for(const [name,overrides] of deny)test('NO-GO '+name,()=>{
  assert.equal(isApprovedRC95UatMutation(signedRequest(),{...env,...overrides},now),false);
});

test('scope restriction denies every nonallowlisted mutating endpoint',()=>{
  for(const path of [
    '/api/orders/123','/api/bank/commands','/api/clients/delete',
    '/api/finance/transfers','/api/staging-login','/api/auth/login',
    '/api/finance/receivables/settlements/not-a-uuid/reverse',
    '/api/orders?admin=true','/api/commands?override=true',
    '/api/orders/not-an-id/documents',
    '/api/orders/123e4567-e89b-12d3-a456-426614174000/documents?bypass=true',
    '/api/integrations/nextcrm/navigation',
  ])assert.equal(isApprovedRC95UatMutation(signedRequest(path),env,now),false,path);
});

test('allowlist covers required synthetic business POST routes only',()=>{
  for(const path of [
    '/api/clients','/api/orders','/api/commands',
    '/api/orders/123e4567-e89b-12d3-a456-426614174000/documents',
    '/api/finance/receivables/settlements',
    '/api/finance/receivables/settlements/123e4567-e89b-12d3-a456-426614174000/reverse',
    '/api/finance/periods/close',
  ])assert.equal(isApprovedRC95UatMutation(signedRequest(path),env,now),true,path);
});

test('signatures cannot be replayed on another path, timestamp or method',()=>{
  assert.equal(isApprovedRC95UatMutation(signedRequest('/api/orders', {token:'v1.1111111111111.'+'a'.repeat(32)+'.'+'b'.repeat(64)}),env,now),false);
  assert.equal(isApprovedRC95UatMutation(signedRequest('/api/orders', {time:now-10001}),env,now),false);
  assert.equal(isApprovedRC95UatMutation(signedRequest('/api/orders', {time:now+10001}),env,now),false);
  assert.equal(isApprovedRC95UatMutation(signedRequest('/api/orders',{noCookie:true}),env,now),false);
  assert.equal(isApprovedRC95UatMutation(signedRequest('/api/orders',{contentType:'text/plain'}),env,now),false);
  assert.equal(isApprovedRC95UatMutation(signedRequest('/api/orders',{method:'DELETE'}),env,now),false);
  const orderToken=issueRC95UatToken(signedRequest('/api/orders'),actor,env.CISNE_RC95_UAT_SIGNING_KEY,now);
  assert.equal(isApprovedRC95UatMutation(signedRequest('/api/clients',{token:orderToken}),env,now),false);
});

test('readonly remains fail-closed for other authenticated users even during UAT',()=>{
  const wrongActor='second-actor';
  const forged=signedRequest('/api/orders',{actor:wrongActor});
  assert.equal(isApprovedRC95UatMutation(forged,env,now),false);
  const ordinary={...env,CISNE_RC95_UAT_ENABLED:'false'};
  assert.equal(isApprovedRC95UatMutation(signedRequest(),ordinary,now),false);
});

test('UAT token refuses malformed inputs without leaking secret values',()=>{
  const bad=signedRequest('/api/orders',{token:'bad-token'});
  assert.equal(isApprovedRC95UatMutation(bad,env,now),false);
});
