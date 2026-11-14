import test from 'node:test';
import assert from 'node:assert/strict';
import {assertRailwayStaging} from '../../scripts/railway-preflight.mjs';

const id = '1f68621a-d07b-476b-87cc-26de71473a3c';
const staging = {RAILWAY_PROJECT_ID:id, RAILWAY_ENVIRONMENT_NAME:'staging', RAILWAY_ENVIRONMENT_ID:'env-staging'};

test('only staging in the approved Railway project is accepted', () => {
  assert.deepEqual(assertRailwayStaging(staging), {
    projectId:id, environmentId:'env-staging', environmentName:'staging',
  });
});

test('production, unknown project and missing staging ID fail closed', () => {
  assert.throws(() => assertRailwayStaging({...staging,RAILWAY_ENVIRONMENT_NAME:'production'}), /RAILWAY_SCOPE_MISMATCH/);
  assert.throws(() => assertRailwayStaging({...staging,RAILWAY_PROJECT_ID:'other'}), /RAILWAY_SCOPE_MISMATCH/);
  assert.throws(() => assertRailwayStaging({...staging,RAILWAY_ENVIRONMENT_ID:''}), /RAILWAY_SCOPE_MISMATCH/);
});
