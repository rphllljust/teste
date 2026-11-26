import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {issueProductionSession,validateProductionSession,productionSessionCookieHeader,CISNE_PRODUCTION_COOKIE,CISNE_PRODUCTION_SESSION_MS} from './production-session.mjs';
import {mutationOriginAllowed} from './mutation-origin.mjs';
const env={RAILWAY_ENVIRONMENT_NAME:'production',CISNE_PRODUCTION_ACTOR_ID:'cisne-prod-owner',
 CISNE_PRODUCTION_SESSION_SECRET:'isolation-test-secret-20261126-production-123456789',
 CISNE_PRODUCTION_PUBLIC_ORIGIN:'https://teste-production-c4f9f56e.up.railway.app'};
function req(cookie='',headers={}){return new Request('https://teste-production-c4f9f56e.up.railway.app/api/orders',{
 headers:{...(cookie?{cookie:CISNE_PRODUCTION_COOKIE+'='+cookie}:{}),...headers}
});}
test('production requires signed cookie, forged actor headers never authorize',()=>{
 const now=Date.UTC(2026,10,26);
 const signed=issueProductionSession(env.CISNE_PRODUCTION_ACTOR_ID,env.CISNE_PRODUCTION_SESSION_SECRET,now);
 assert.equal(validateProductionSession(req(signed),env,now+1),env.CISNE_PRODUCTION_ACTOR_ID);
 assert.equal(validateProductionSession(req('',{'oai-authenticated-user-id':'forged-admin'}),env,now),null);
 assert.equal(validateProductionSession(req(signed),{...env,RAILWAY_ENVIRONMENT_NAME:'staging'},now),null);
 assert.equal(validateProductionSession(req(signed),{...env,CISNE_PRODUCTION_ACTOR_ID:'other-actor'},now),null);
 assert.equal(validateProductionSession(req(signed.slice(0,-1)+'A'),env,now),null);
 assert.equal(validateProductionSession(req(signed),env,now+CISNE_PRODUCTION_SESSION_MS+1),null);
 assert.match(productionSessionCookieHeader(signed),/Secure; HttpOnly; SameSite=Strict/);
});
test('production mutation origin must be canonical HTTPS and never internal proxy origin',()=>{
 const url='http://internal:8080/api/orders';
 const good=new Request(url,{headers:{origin:env.CISNE_PRODUCTION_PUBLIC_ORIGIN}});
 const forged=new Request(url,{headers:{origin:'https://evil.example'}});
 assert.equal(mutationOriginAllowed(good,env),true);
 assert.equal(mutationOriginAllowed(forged,env),false);
 assert.equal(mutationOriginAllowed(good,{...env,CISNE_PRODUCTION_PUBLIC_ORIGIN:'https://evil.example'}),false);
});
test('production request context explicitly validates server signed cookie',()=>{
 const src=readFileSync(new URL('./http.ts',import.meta.url),'utf8');
 assert.match(src,/RAILWAY_ENVIRONMENT_NAME==='production'/);
 assert.match(src,/validateProductionSession\(request\)/);
 assert.doesNotMatch(src,/RAILWAY_ENVIRONMENT_NAME==='production'\s*\?\s*request\.headers\.get/);
});
