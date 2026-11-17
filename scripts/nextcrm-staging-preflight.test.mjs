import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNextcrmStagingPredeploy } from './nextcrm-staging-preflight.mjs';

const good = {
  RAILWAY_ENVIRONMENT_NAME:'staging',NODE_ENV:'production',PORT:'3000',
  CISNE_NEXTCRM_INSTANCE_KEY:'cisne-hml-2026',
  CISNE_NEXTCRM_BRIDGE_SECRET:'f'.repeat(64),
  BETTER_AUTH_SECRET:'a'.repeat(64), EMAIL_ENCRYPTION_KEY:'b'.repeat(64),
  INNGEST_EVENT_KEY:'c'.repeat(64), INNGEST_SIGNING_KEY:'d'.repeat(64),
  INNGEST_BASE_URL:'http://nextcrm-jobs.railway.internal:8288',
  INNGEST_DEV:'0',SEED_DEMO_DATA:'0',
  MINIO_ENDPOINT:'http://nextcrm-minio.railway.internal:9000',
  MINIO_PUBLIC_ENDPOINT:'https://files.hml.example.org',
  MINIO_BUCKET:'nextcrm',MINIO_ACCESS_KEY:'ci-nextcrm',
  MINIO_SECRET_KEY:'e'.repeat(64),
  BETTER_AUTH_URL:'https://nextcrm-gateway-staging.up.railway.app',
  APP_URL:'https://nextcrm-gateway-staging.up.railway.app',
  NEXT_PUBLIC_APP_URL:'https://nextcrm-gateway-staging.up.railway.app',
  EMAIL_FROM:'notifications@example.org',
  RESEND_API_KEY:'re_ci_testing_only_fake',
  TEST_USER_EMAIL:'staging-admin@example.org',
  DATABASE_URL:'postgresql://nextcrm:'+'f'.repeat(64)+'@nextcrm-postgres.railway.internal:5432/nextcrm',
  DB_HOST:'nextcrm-postgres.railway.internal',DB_USER:'nextcrm',
  DB_NAME:'nextcrm',DB_PORT:'5432',DB_PASSWORD:'f'.repeat(64),
};
test('stage-only, isolated and intentionally synthetic fields meet format contract',()=>{
  assert.deepEqual(validateNextcrmStagingPredeploy(good),[]);
});
test('never accidentally deploy with incomplete secrets or unsafe URLs, production, or seeded data',()=>{
  for(const [name,value] of [
    ['RAILWAY_ENVIRONMENT_NAME','production'],
    ['CISNE_NEXTCRM_BRIDGE_SECRET','weak'],
    ['BETTER_AUTH_URL','http://crm.hml.example.org'],
    ['BETTER_AUTH_URL','https://nextcrm-gateway-staging.up.railway.app:3000'],
    ['APP_URL','https://nextcrm-gateway-staging.up.railway.app:3000'],
    ['NEXT_PUBLIC_APP_URL','https://nextcrm-gateway-staging.up.railway.app:3000'],
    ['BETTER_AUTH_URL','https://nextcrm-web.railway.internal:3000'],
    ['APP_URL','https://misdirected.example.org'],
    ['NEXT_PUBLIC_APP_URL','https://evil.example.org'],
    ['MINIO_PUBLIC_ENDPOINT','http://minio:9000'],
    ['DATABASE_URL','postgresql://user:pass@Postgres.railway.internal:5432/ERP'],
    ['INNGEST_SIGNING_KEY','broken'],
    ['EMAIL_ENCRYPTION_KEY','broken'],
    ['SEED_DEMO_DATA','1'],
    ['TEST_USER_EMAIL','admin@example.invalid'],
    ['EMAIL_FROM','admin@example.invalid'],
    ['RESEND_API_KEY',''],
  ]){
    const candidate={...good,[name]:value};
    assert.ok(validateNextcrmStagingPredeploy(candidate).includes(name),'expected denial for '+name);
  }
  assert.ok(validateNextcrmStagingPredeploy({}).length>=20);
});

const isolated = {
  ...good,
  CISNE_RC84_RAILWAY_BUCKET_MODE:'true',
  CISNE_NEXTCRM_INSTANCE_KEY:'rc84_isolated_hml',
  INNGEST_DEV:'1',
  INNGEST_BASE_URL:undefined,
  MINIO_ENDPOINT:'https://storage.railway.app',
  MINIO_PUBLIC_ENDPOINT:'https://storage.railway.app',
  MINIO_BUCKET:'rc84-nextcrm-isolated-objects-a92f4',
  BETTER_AUTH_URL:'http://localhost:3000',
  APP_URL:'http://localhost:3000',
  NEXT_PUBLIC_APP_URL:'http://localhost:3000',
  EMAIL_FROM:'rc84-no-send@example.invalid',
  TEST_USER_EMAIL:'rc84-only@example.invalid',
  RESEND_API_KEY:undefined,
  DATABASE_URL:'postgresql://nextcrm:'+'f'.repeat(64)+'@nextcrm-rc84-isolated-pg.railway.internal:5432/nextcrm_rc84',
  DB_HOST:'nextcrm-rc84-isolated-pg.railway.internal',
  DB_NAME:'nextcrm_rc84',
};
test('RC85 allows a standalone private-only synthetic NextCRM with independent PostgreSQL and native S3',()=>{
  assert.deepEqual(validateNextcrmStagingPredeploy(isolated),[]);
});
test('RC85 rejects old legacy DB or bucket, production, public login, email and weak keys',()=>{
  const failures=[
    ['RAILWAY_ENVIRONMENT_NAME','production'],
    ['MINIO_BUCKET','nextcrm'],
    ['MINIO_ENDPOINT','http://nextcrm-minio.railway.internal:9000'],
    ['MINIO_PUBLIC_ENDPOINT','https://evil.invalid'],
    ['DATABASE_URL',good.DATABASE_URL],
    ['DB_HOST','nextcrm-postgres.railway.internal'],
    ['CISNE_NEXTCRM_INSTANCE_KEY','cisne-hml-2026'],
    ['BETTER_AUTH_URL',good.BETTER_AUTH_URL],
    ['APP_URL',good.APP_URL],
    ['NEXT_PUBLIC_APP_URL',good.NEXT_PUBLIC_APP_URL],
    ['RESEND_API_KEY','re_production_secret'],
    ['EMAIL_FROM','real-user@example.org'],
    ['INNGEST_DEV','0'],
    ['INNGEST_BASE_URL',good.INNGEST_BASE_URL],
    ['SEED_DEMO_DATA','1'],
    ['CISNE_NEXTCRM_BRIDGE_SECRET','broken'],
    ['DB_PASSWORD','different-private-db-key'],
  ];
  for(const [name,value] of failures){
    const b={...isolated,[name]:value};
    const expectedField = name === 'DB_PASSWORD' ? 'DATABASE_URL' : name;
    assert.ok(validateNextcrmStagingPredeploy(b).includes(expectedField),'must reject '+name);
  }
  assert.ok(validateNextcrmStagingPredeploy({...isolated,RAILWAY_ENVIRONMENT_NAME:'production'}).length>0);
  assert.deepEqual(validateNextcrmStagingPredeploy({...good,CISNE_RC84_RAILWAY_BUCKET_MODE:'true'})
    .includes('DATABASE_URL'),true);
});
