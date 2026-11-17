import test from 'node:test';
import assert from 'node:assert/strict';
import {
  approvedNextcrmPrivateBridge,
  approvedNextcrmMinioOrigin,
  selectedNextcrmPrivateBridge,
} from './approved-railway-targets.mjs';

const originalBridge='http://nextcrm-web.railway.internal:3000';
const isolatedBridge='http://nextcrm-rc84-isolated-web.railway.internal:3000';
const originalStorage='https://nextcrm-minio-staging.up.railway.app';
const isolatedStorage='https://nextcrm-rc84-isolated-minio-staging.up.railway.app';

test('existing target remains the production-safe default',()=>{
  assert.equal(selectedNextcrmPrivateBridge({RAILWAY_ENVIRONMENT_NAME:'production'}),originalBridge);
  assert.equal(selectedNextcrmPrivateBridge({RAILWAY_ENVIRONMENT_NAME:'staging'}),originalBridge);
  assert.equal(approvedNextcrmPrivateBridge(originalBridge,{RAILWAY_ENVIRONMENT_NAME:'production'}),true);
  assert.equal(approvedNextcrmMinioOrigin(originalStorage,{RAILWAY_ENVIRONMENT_NAME:'production'}),true);
});
test('isolated targets require an explicit staging configuration',()=>{
  const env={RAILWAY_ENVIRONMENT_NAME:'staging',CISNE_NEXTCRM_PRIVATE_ORIGIN:isolatedBridge};
  assert.equal(selectedNextcrmPrivateBridge(env),isolatedBridge);
  assert.equal(approvedNextcrmPrivateBridge(isolatedBridge,env),true);
  assert.equal(approvedNextcrmMinioOrigin(isolatedStorage,env),true);
  assert.equal(approvedNextcrmPrivateBridge(isolatedBridge,{RAILWAY_ENVIRONMENT_NAME:'production'}),false);
  assert.equal(approvedNextcrmMinioOrigin(isolatedStorage,{RAILWAY_ENVIRONMENT_NAME:'production'}),false);
});
test('Railway Bucket origin must be the exact private RC84 bucket virtual host',()=>{
  const env={RAILWAY_ENVIRONMENT_NAME:'staging',CISNE_RC84_RAILWAY_BUCKET_MODE:'true'};
  const bucket='rc84-nextcrm-isolated-objects-a92f4';
  assert.equal(selectedNextcrmPrivateBridge(env),'invalid:rc84-missing-private-crm-target');
  assert.equal(approvedNextcrmMinioOrigin('https://'+bucket+'.storage.railway.app',env,bucket),true);
  assert.equal(approvedNextcrmMinioOrigin(originalStorage,env,'nextcrm'),false,
    'Isolated RC84 mode must never use legacy MinIO');
  assert.equal(approvedNextcrmMinioOrigin('https://'+bucket+'.t3.storageapi.dev',env,bucket),true);
  assert.equal(approvedNextcrmMinioOrigin('https://'+bucket+'.storage.railway.app',env,'wrong-bucket'),false);
  assert.equal(approvedNextcrmMinioOrigin('https://'+bucket+'.storage.railway.app',
    {RAILWAY_ENVIRONMENT_NAME:'production',CISNE_RC84_RAILWAY_BUCKET_MODE:'true'},bucket),false);
  assert.equal(approvedNextcrmMinioOrigin('https://evil.storage.railway.app',env,bucket),false);
  assert.equal(approvedNextcrmMinioOrigin('https://'+bucket+'.storage.railway.app:9000',env,bucket),false);
  assert.equal(approvedNextcrmMinioOrigin('https://'+bucket+'.storage.railway.app/documents',env,bucket),false);
});
test('RC84 isolated mode refuses shared legacy CRM bridge and legacy object storage',()=>{
  const env={
    RAILWAY_ENVIRONMENT_NAME:'staging',
    CISNE_RC84_RAILWAY_BUCKET_MODE:'true',
    CISNE_NEXTCRM_PRIVATE_ORIGIN:originalBridge,
  };
  assert.equal(selectedNextcrmPrivateBridge(env),originalBridge);
  assert.equal(approvedNextcrmPrivateBridge(originalBridge,env),false,
    'Explicit legacy CRM destination is prohibited in isolated bucket mode');
  assert.equal(approvedNextcrmPrivateBridge(isolatedBridge,env),true);
  assert.equal(approvedNextcrmMinioOrigin(originalStorage,env,'nextcrm'),false);
  assert.equal(approvedNextcrmMinioOrigin(isolatedStorage,env,'nextcrm'),false);
  assert.equal(approvedNextcrmPrivateBridge(isolatedBridge,{
    ...env, RAILWAY_ENVIRONMENT_NAME:'production',
  }),false);
  assert.equal(approvedNextcrmMinioOrigin(originalStorage,{
    ...env, RAILWAY_ENVIRONMENT_NAME:'production',
  },'nextcrm'),false);
  assert.equal(selectedNextcrmPrivateBridge({
    ...env, RAILWAY_ENVIRONMENT_NAME:'production',
  }),'invalid:rc84-outside-staging');
});

test('never fall back to live NextCRM when configured staging destination is malformed',()=>{
  const bad='http://attacker.invalid:3000';
  const env={RAILWAY_ENVIRONMENT_NAME:'staging',CISNE_NEXTCRM_PRIVATE_ORIGIN:bad};
  assert.equal(selectedNextcrmPrivateBridge(env),bad);
  assert.equal(approvedNextcrmPrivateBridge(bad,env),false);
});
test('deny credentials, ports, paths, query, misdirected domains and S3 buckets',()=>{
  const stage={RAILWAY_ENVIRONMENT_NAME:'staging'};
  for(const target of [
    'https://nextcrm-rc84-isolated-web.railway.internal:3000',
    'http://user:pass@nextcrm-rc84-isolated-web.railway.internal:3000',
    'http://nextcrm-rc84-isolated-web.railway.internal:3001',
    'http://nextcrm-rc84-isolated-web.railway.internal:3000/secret',
    'http://nextcrm-rc84-isolated-web.railway.internal:3000?bypass=1',
    'http://nextcrm-rc84-isolated-web.railway.internal.evil.test:3000',
  ])assert.equal(approvedNextcrmPrivateBridge(target,stage),false,target);
  for(const target of [
    'http://nextcrm-rc84-isolated-minio-staging.up.railway.app',
    'https://nextcrm-rc84-isolated-minio-staging.up.railway.app:9000',
    'https://evil.example.invalid',
    'https://nextcrm-rc84-isolated-minio-staging.up.railway.app/nextcrm',
    'https://evil@nextcrm-rc84-isolated-minio-staging.up.railway.app',
    'https://nextcrm-rc84-isolated-minio-staging.up.railway.app?secret=1',
  ])assert.equal(approvedNextcrmMinioOrigin(target,stage),false,target);
});
