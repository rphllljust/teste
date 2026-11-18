import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {getPool,closeDatabase} from '../../db/raw';
import {CISNE_STAGING_COOKIE,issueStagingSession} from '../../lib/api/staging-session.mjs';
import {issueRC95UatToken} from '../../lib/api/staging-uat-mutation.mjs';
import {withRC98SignedDbScope} from '../../lib/api/staging-uat-db-scope.mjs';

// Actual INSERT against disposable PG16/18, rolled back in the same transaction.
// NEVER use on Railway: refusing any nonlocal target is part of this test.
if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
  throw Error('RC100_NO_GO_REQUIRES_DISPOSABLE_NODE_TEST_PG');
const target=new URL(process.env.DATABASE_URL);
if(!['127.0.0.1','localhost'].includes(target.hostname) ||
   target.port!=='5432' ||
   !['/cisne_test','/cisne_ci'].includes(target.pathname))
  throw Error('RC100_NO_GO_REJECTS_REMOTE_OR_NONDISPOSABLE_DATABASE');

const actor='rc100-disposable-synthetic-actor';
const secret='rc100-only-local-test-cookie-secret-not-real';
const signing='e'.repeat(64);
const names=[
  'RAILWAY_PROJECT_ID','RAILWAY_ENVIRONMENT_ID','RAILWAY_ENVIRONMENT_NAME',
  'RAILWAY_SERVICE_ID','RAILWAY_SERVICE_NAME','CISNE_STAGING_ACCESS_MODE',
  'CISNE_STAGING_READ_ONLY','CISNE_STAGING_ACTOR_ID',
  'CISNE_STAGING_SESSION_SECRET','CISNE_RC95_UAT_ENABLED',
  'CISNE_RC95_UAT_ACTOR_ID','CISNE_RC95_UAT_SIGNING_KEY',
  'CISNE_RC95_UAT_UNTIL_MS',
] as const;
const originals=new Map(names.map(key=>[key,process.env[key]]));
Object.assign(process.env,{
  RAILWAY_PROJECT_ID:'0835d357-6037-42e6-a534-6456422e1cf3',
  RAILWAY_ENVIRONMENT_ID:'c241a855-68b7-4d75-a722-b6a42c8581e9',
  RAILWAY_ENVIRONMENT_NAME:'staging',
  RAILWAY_SERVICE_ID:'fed95ca7-f373-4e6a-983f-2f591f26672e',
  RAILWAY_SERVICE_NAME:'cisne-rc85-ephemeral-erp',
  CISNE_STAGING_ACCESS_MODE:'private',
  CISNE_STAGING_READ_ONLY:'true',
  CISNE_STAGING_ACTOR_ID:actor,
  CISNE_STAGING_SESSION_SECRET:secret,
  CISNE_RC95_UAT_ENABLED:'true',
  CISNE_RC95_UAT_ACTOR_ID:actor,
  CISNE_RC95_UAT_SIGNING_KEY:signing,
  CISNE_RC95_UAT_UNTIL_MS:String(Date.now()+180000),
});
after(async()=>{
  await closeDatabase();
  for(const [name,value] of originals){
    if(value===undefined)delete process.env[name];
    else process.env[name]=value;
  }
});

function syntheticRequest(signed:boolean){
  const url='http://cisne-rc85-ephemeral-erp.railway.internal:8080/api/orders';
  const cookie=CISNE_STAGING_COOKIE+'='+issueStagingSession(actor,secret);
  const incoming=new Request(url,{method:'POST',headers:{
    cookie,'content-type':'application/json',
  }});
  return new Request(url,{method:'POST',headers:{
    cookie,'content-type':'application/json',
    ...(signed?{'x-cisne-rc95-uat':issueRC95UatToken(incoming,actor,signing)}:{}),
  }});
}
function insertSql(){
 return 'INSERT INTO clients (id,owner_id,legal_name,created_at,updated_at) VALUES ($1,$2,$3,$4,$4)';
}

test('RC100: actual signed SQL writer executes INSERT and ROLLBACK while normal pool is read-only',async()=>{
  await closeDatabase();
  const id=randomUUID();
  const request=syntheticRequest(true);
  await withRC98SignedDbScope(request,async()=>{
    const db=await getPool().connect();
    let began=false;
    try{
      const status=await db.query('SHOW default_transaction_read_only');
      assert.equal(status.rows[0]?.default_transaction_read_only,'off');
      await db.query('BEGIN');began=true;
      const created=await db.query(insertSql(),
        [id,actor,'RC100 synthetic disposable write',new Date().toISOString()]);
      assert.equal(created.rowCount,1);
      const within=await db.query('SELECT count(*)::int AS n FROM clients WHERE id=$1',[id]);
      assert.equal(within.rows[0].n,1);
    }finally{
      if(began)await db.query('ROLLBACK');
      db.release();
    }
  },process.env);
  const ordinary=getPool();
  const status=await ordinary.query('SHOW default_transaction_read_only');
  assert.equal(status.rows[0]?.default_transaction_read_only,'on');
  const persisted=await ordinary.query('SELECT count(*)::int AS n FROM clients WHERE id=$1',[id]);
  assert.equal(persisted.rows[0].n,0,'The synthetic INSERT must never persist');
});

test('RC100: unsigned POST still hits SQLSTATE 25006 even when same worker carries armed UAT env',async()=>{
  const id=randomUUID();
  await withRC98SignedDbScope(syntheticRequest(false),async()=>{
    const ordinary=getPool();
    assert.equal((await ordinary.query('SHOW default_transaction_read_only')).rows[0]?.default_transaction_read_only,'on');
    await assert.rejects(
      ordinary.query(insertSql(),[id,actor,'Unauthorized RC100 write',new Date().toISOString()]),
      (error:unknown)=>typeof error==='object'&&error!==null&&
        'code' in error&&error.code==='25006',
    );
  },process.env);
  const result=await getPool().query('SELECT count(*)::int AS n FROM clients WHERE id=$1',[id]);
  assert.equal(result.rows[0].n,0);
});

test('RC100: overlapping authorized writer and unauthenticated query have distinct SQL modes',async()=>{
  const results=await Promise.all([
    withRC98SignedDbScope(syntheticRequest(true),async()=>{
      await new Promise(resolve=>setImmediate(resolve));
      return (await getPool().query('SHOW default_transaction_read_only'))
        .rows[0]?.default_transaction_read_only;
    },process.env),
    withRC98SignedDbScope(syntheticRequest(false),async()=>{
      await new Promise(resolve=>setImmediate(resolve));
      return (await getPool().query('SHOW default_transaction_read_only'))
        .rows[0]?.default_transaction_read_only;
    },process.env),
  ]);
  assert.deepEqual(results,['off','on']);
  assert.equal((await getPool().query('SHOW default_transaction_read_only'))
    .rows[0]?.default_transaction_read_only,'on');
});
