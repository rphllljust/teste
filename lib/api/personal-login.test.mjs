import test from 'node:test';
import assert from 'node:assert/strict';
import {hashPersonalPassword,normalizeHandle,eligiblePassword} from './personal-login.mjs';
import {CISNE_STAGING_COOKIE,CISNE_PERSONAL_SESSION_MS,
 issuePersonalStagingSession,issueStagingSession,validateStagingSession,
 personalStagingSessionCookieHeader} from './staging-session.mjs';

const secret='local-test-only-key-must-have-32-bytes-20261128'.repeat(2);
const env={
 RAILWAY_ENVIRONMENT_NAME:'staging',CISNE_STAGING_AUTH_MODE:'individual',
 CISNE_STAGING_SESSION_SECRET:secret,CISNE_STAGING_ACTOR_ID:'shared-disabled-actor',
};
const req=token=>new Request('https://cisne-web-staging-staging.up.railway.app/api/crm',{
 headers:{cookie:CISNE_STAGING_COOKIE+'='+token},
});

test('scrypt uses random 32-byte salt, 64-byte hash and strict passphrase policy',async()=>{
 assert.equal(normalizeHandle(' Owner.One '),'owner.one');
 assert.equal(normalizeHandle('../../admin'),null);
 assert.equal(eligiblePassword('short'),false);
 const a=await hashPersonalPassword('Synthetic-Password-For-Auth-Testing-123456');
 const b=await hashPersonalPassword('Synthetic-Password-For-Auth-Testing-123456');
 assert.equal(a.salt.length,32);assert.equal(a.hash.length,64);
 assert.notDeepEqual(a.salt,b.salt);
 assert.notDeepEqual(a.hash,b.hash);
});
test('individual signed cookies cannot be substituted by shared staging identity',()=>{
 const now=Date.now(),owner='synthetic-personal-owner-001';
 const personal=issuePersonalStagingSession(owner,secret,now);
 assert.equal(validateStagingSession(req(personal),env,now+1),owner);
 assert.equal(validateStagingSession(req(personal),{...env,CISNE_STAGING_AUTH_MODE:'shared'},now+1),null);
 assert.equal(validateStagingSession(req(issueStagingSession(env.CISNE_STAGING_ACTOR_ID,secret,now)),env,now+1),null);
 assert.equal(validateStagingSession(req(personal),env,now+CISNE_PERSONAL_SESSION_MS+1),null);
 assert.equal(validateStagingSession(req(personal),{...env,CISNE_STAGING_SESSION_SECRET:'rotated-'+secret},now+1),null);
 const tampered=personal.split('.');
 const digest=Buffer.from(tampered[1],'base64url');digest[0]^=0xff;
 assert.equal(validateStagingSession(req(tampered[0]+'.'+digest.toString('base64url')),env,now+1),null);
 const cookie=personalStagingSessionCookieHeader(personal);
 assert.match(cookie,/Max-Age=1800/);assert.match(cookie,/; Secure; HttpOnly; SameSite=Strict/);
 assert.doesNotMatch(cookie,/Domain=/);
});
