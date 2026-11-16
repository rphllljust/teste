import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROTECTED_MIGRATION,sqlDigest,validateRestoreAttestation,
} from './migration-safety.mjs';

const migration='-- immutability fixture\nCREATE TABLE example(id text);';
const sqlHash=sqlDigest(migration);
const now=Date.UTC(2026,10,15,23,0,0);
const isolatedDb='postgresql://cisne_test:cisne_test@localhost:5432/cisne_test';
const permanentDb='postgresql://operator:secret@postgres.railway.internal:5432/cisne_db';
const evidence={
  migrationId:PROTECTED_MIGRATION,
  migrationSha256:sqlHash,
  backupId:'backup-20261115-before-0002',
  restoreTarget:'cisne_restore_separate_20261115',
  verifiedBy:'operations-reviewer',
  verifiedAt:new Date(now-10*60_000).toISOString(),
};
const stable={DATABASE_URL:permanentDb,RAILWAY_ENVIRONMENT_NAME:'staging'};
const inspect=(env)=>validateRestoreAttestation({
  migrationId:PROTECTED_MIGRATION,sql:migration,env,now,
});
const withEvidence=(input=evidence)=>({
  ...stable,CISNE_DB_RESTORE_ATTESTATION:JSON.stringify(input),
});
test('migration hash binds to exact SQL bytes',()=>{
  assert.equal(sqlHash.length,64);
  assert.notEqual(sqlHash,sqlDigest(migration+'\n'));
});
test('only the exact GitHub disposable CI DB can skip restore evidence',()=>{
  assert.deepEqual(inspect({
    ...stable,CI:'true',GITHUB_ACTIONS:'true',NODE_ENV:'test',
    DATABASE_URL:isolatedDb,
  }),{kind:'ci-disposable'});
  for(const env of [
    {...stable,CI:'true',GITHUB_ACTIONS:'true',NODE_ENV:'test'},
    {...stable,CI:'true',NODE_ENV:'test',DATABASE_URL:isolatedDb},
    {...stable,GITHUB_ACTIONS:'true',NODE_ENV:'test',DATABASE_URL:isolatedDb},
    {...stable,CI:'true',GITHUB_ACTIONS:'true',NODE_ENV:'production',DATABASE_URL:isolatedDb},
    {...stable,CI:'true',GITHUB_ACTIONS:'true',NODE_ENV:'test',
      DATABASE_URL:'postgresql://cisne_test:cisne_test@localhost:5432/real_data'},
  ])assert.throws(()=>inspect(env),/MIGRATION_BACKUP_NO_GO/);
});
test('staging and production fail closed without or with false evidence',()=>{
  for(const env of [
    stable,
    {...stable,RAILWAY_ENVIRONMENT_NAME:'production'},
    {...stable,CISNE_DB_RESTORE_ATTESTATION:'not-json'},
    withEvidence({...evidence,migrationSha256:'0'.repeat(64)}),
    withEvidence({...evidence,migrationId:'0001_native_crm'}),
    withEvidence({...evidence,backupId:''}),
    withEvidence({...evidence,restoreTarget:'cisne_db'}),
    withEvidence({...evidence,verifiedAt:new Date(now-73*60*60_000).toISOString()}),
    withEvidence({...evidence,verifiedAt:new Date(now+6*60_000).toISOString()}),
    withEvidence({...evidence,verifiedBy:'malicious\nlogger'}),
  ])assert.throws(()=>inspect(env),/MIGRATION_BACKUP_NO_GO/);
});
test('reviewed, fresh restore attestation accepts exact migration only',()=>{
  assert.deepEqual(inspect(withEvidence()),{
    kind:'attested',
    migrationId:PROTECTED_MIGRATION,digest:sqlHash,
    backupId:evidence.backupId,restoreTarget:evidence.restoreTarget,
    verifiedAt:evidence.verifiedAt,
  });
  assert.throws(()=>validateRestoreAttestation({
    migrationId:PROTECTED_MIGRATION,
    sql:migration+' -- changed',env:withEvidence(),now,
  }),/MIGRATION_BACKUP_NO_GO/);
});
