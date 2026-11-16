import test from 'node:test';
import assert from 'node:assert/strict';
import {workerSafePoolMaxUses} from './worker-pool-policy.mjs';

test('any Railway worker environment discards sockets across requests',()=>{
  for(const environment of ['staging','production','preview','custom']){
    assert.equal(workerSafePoolMaxUses({RAILWAY_ENVIRONMENT_NAME:environment}),1);
  }
});
test('isolated Node CI remains on normal pooled connections',()=>{
  assert.equal(workerSafePoolMaxUses({}),10000);
  assert.equal(workerSafePoolMaxUses({RAILWAY_ENVIRONMENT_NAME:''}),10000);
});
