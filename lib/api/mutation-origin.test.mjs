import test from 'node:test';
import assert from 'node:assert/strict';
import {mutationOriginAllowed} from './mutation-origin.mjs';
import {approvedStagingPublicOrigin} from './staging-public-origin.mjs';

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
test('non-staging origin comparison retains prior Request.url contract',()=>{
  const other={RAILWAY_ENVIRONMENT_NAME:'production'};
  const local='http://cisne-web-staging.railway.internal:8080';
  assert.equal(mutationOriginAllowed(request(local),other),true);
  assert.equal(mutationOriginAllowed(request(publicOrigin),other),false);
});

test('separate Railway RC origin works only after exact deployment-local configuration',()=>{
  const preview='https://cisne-web-rc74-staging.up.railway.app';
  const otherEnv={...env,CISNE_STAGING_PUBLIC_ORIGIN:preview};
  assert.equal(approvedStagingPublicOrigin(otherEnv),preview);
  assert.equal(mutationOriginAllowed(request(preview),otherEnv),true);
  assert.equal(mutationOriginAllowed(request(publicOrigin),otherEnv),false,
    'Original staging domain must not be accepted by isolated RC');
  assert.equal(mutationOriginAllowed(request(preview),env),false,
    'RC domain must not be accepted on original staging');
});

test('forged configuration, internal hosts and invalid origin shapes fail closed',()=>{
  for(const invalid of [
    'http://cisne-web-rc74-staging.up.railway.app',
    'https://cisne-web-rc74-staging.up.railway.app.evil.invalid',
    'https://cisne-web-rc74-staging.up.railway.app:8443',
    'https://cisne-web-rc74-staging.up.railway.app/',
    'https://cisne-web-rc74-staging.up.railway.app/path',
    'https://cisne-web-rc74-staging.up.railway.app?foo=bar',
    'https://user@cisne-web-rc74-staging.up.railway.app',
    'https://nextcrm.railway.internal',
    'https://127.0.0.1',
    'https://evil.example',
  ]){
    const guarded={...env,CISNE_STAGING_PUBLIC_ORIGIN:invalid};
    assert.equal(approvedStagingPublicOrigin(guarded),null,
      'Invalid trusted staging origin must be rejected');
    assert.equal(mutationOriginAllowed(request(invalid),guarded),false);
  }
  assert.equal(approvedStagingPublicOrigin({...env,RAILWAY_ENVIRONMENT_NAME:'production'}),null,
    'Preview session must not be enabled in production');
});
