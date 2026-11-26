import test from 'node:test';
import assert from 'node:assert/strict';
import {mutationOriginAllowed} from './mutation-origin.mjs';

const publicOrigin='https://cisne-web-staging-staging.up.railway.app';
const env={RAILWAY_ENVIRONMENT_NAME:'staging',CISNE_STAGING_PUBLIC_ORIGIN:publicOrigin};
const request=(origin)=>new Request('http://cisne-web-staging.railway.internal:8080/api/clients',{
  method:'POST',headers:origin===undefined?{}:{origin},
});
test('Railway staging accepts exact public HTTPS Origin behind internal HTTP proxy',()=>{
  assert.equal(mutationOriginAllowed(request(publicOrigin),env),true);
});
test('Railway staging rejects forged and lookalike mutation origins',()=>{
  for(const origin of [
    'https://evil.example',
    'http://cisne-web-staging-staging.up.railway.app',
    'https://cisne-web-staging-staging.up.railway.app.evil.example',
    'https://nextcrm-gateway-staging.up.railway.app',
  ])assert.equal(mutationOriginAllowed(request(origin),env),false);
  assert.equal(mutationOriginAllowed(request(publicOrigin),{RAILWAY_ENVIRONMENT_NAME:'staging'}),false);
});
test('server-to-server calls without Origin retain existing behavior',()=>{
  assert.equal(mutationOriginAllowed(request(undefined),env),true);
});
test('production accepts only its canonical HTTPS origin, not Railway internal URLs',()=>{
  const other={RAILWAY_ENVIRONMENT_NAME:'production',CISNE_PRODUCTION_PUBLIC_ORIGIN:'https://teste-production-c4f9f56e.up.railway.app'};
  const local='http://cisne-web-staging.railway.internal:8080';
  assert.equal(mutationOriginAllowed(request(local),other),false);
  assert.equal(mutationOriginAllowed(request(other.CISNE_PRODUCTION_PUBLIC_ORIGIN),other),true);
  assert.equal(mutationOriginAllowed(request(publicOrigin),other),false);
  assert.equal(mutationOriginAllowed(request(other.CISNE_PRODUCTION_PUBLIC_ORIGIN),{RAILWAY_ENVIRONMENT_NAME:'production'}),false);
});
test('local non-Railway invocation retains original Request.url origin contract',()=>{
  const local='http://cisne-web-staging.railway.internal:8080';
  assert.equal(mutationOriginAllowed(request(local),{}),true);
  assert.equal(mutationOriginAllowed(request(publicOrigin),{}),false);
});
