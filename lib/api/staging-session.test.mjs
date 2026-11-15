import test from 'node:test';
import assert from 'node:assert/strict';
import {
  issueStagingSession, validateStagingSession, stagingSessionCookieHeader,
  clearedStagingSessionCookie, CISNE_STAGING_COOKIE, CISNE_SESSION_DURATION_MS,
} from './staging-session.mjs';
import { stagingBoundaryError } from './staging-access.mjs';

const env={
  RAILWAY_ENVIRONMENT_NAME:'staging',
  CISNE_STAGING_SESSION_SECRET:'test-hmac-key-with-minimum-32-bytes-20261115'.repeat(2),
  CISNE_STAGING_ACTOR_ID:'staging-user-uuid-1',
};
function request(token,extra={}){
  return new Request('https://cisne-web-staging-staging.up.railway.app/api/crm',{
    headers:{...(token?{cookie:CISNE_STAGING_COOKIE+'='+token}:{}),...extra},
  });
}
test('signed session opens staging only for configured actor',()=>{
  const now=Date.now();
  const token=issueStagingSession(env.CISNE_STAGING_ACTOR_ID,env.CISNE_STAGING_SESSION_SECRET,now);
  const r=request(token);
  assert.equal(validateStagingSession(r,env,now+1),'staging-user-uuid-1');
  assert.equal(stagingBoundaryError(r,env),null);
  assert.equal(validateStagingSession(r,{...env,RAILWAY_ENVIRONMENT_NAME:'production'},now+1),null);
  assert.equal(validateStagingSession(r,{...env,CISNE_STAGING_ACTOR_ID:'other-user'},now+1),null);
  assert.equal(validateStagingSession(r,{...env,CISNE_STAGING_SESSION_SECRET:'rotated-key-with-minimum-32-bytes-20261115'},now+1),null);
});
test('forged identity headers, changed signatures and expired cookies are denied',()=>{
  const now=Date.now();
  const token=issueStagingSession(env.CISNE_STAGING_ACTOR_ID,env.CISNE_STAGING_SESSION_SECRET,now);
  const anonymous=request(undefined,{'oai-authenticated-user-id':'forged-admin'});
  assert.equal(stagingBoundaryError(anonymous,env)?.status,403);
  const tampered=token.slice(0,-2)+'00';
  assert.equal(validateStagingSession(request(tampered),env,now),null);
  assert.equal(validateStagingSession(request(token),env,now+CISNE_SESSION_DURATION_MS+1),null);
  assert.equal(validateStagingSession(request(token),env,now-61000),null);
  assert.equal(stagingBoundaryError(request('broken.token'),env)?.status,403);
});
test('cookie is host-only, secure, HttpOnly and bounded to eight hours',()=>{
  const token=issueStagingSession(env.CISNE_STAGING_ACTOR_ID,env.CISNE_STAGING_SESSION_SECRET);
  const cookie=stagingSessionCookieHeader(token);
  assert.match(cookie,/^__Host-cisne_staging=/);
  assert.match(cookie,/; Secure; HttpOnly; SameSite=Lax/);
  assert.match(cookie,/; Path=\/; Max-Age=28800/);
  assert.doesNotMatch(cookie, /Domain=/);
  assert.match(clearedStagingSessionCookie(),/Max-Age=0/);
});
