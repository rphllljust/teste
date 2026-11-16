import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getPool, closeDatabase } from '../../db/raw';

if(process.env.NODE_ENV!=='test' || !process.env.DATABASE_URL)
  throw Error('NO-GO: read-only RC test requires disposable database');
const url=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(url.hostname) ||
    !['/cisne_test','/cisne_ci'].includes(url.pathname) || url.port!=='5432')
  throw Error('NO-GO: test refuses persistent PostgreSQL');

test('read-only preview opens a server-enforced PostgreSQL read-only connection',async()=>{
  const previousEnv=process.env.RAILWAY_ENVIRONMENT_NAME;
  const previousFlag=process.env.CISNE_STAGING_READ_ONLY;
  const id=randomUUID();
  try{
    process.env.RAILWAY_ENVIRONMENT_NAME='staging';
    process.env.CISNE_STAGING_READ_ONLY='true';
    await closeDatabase();
    const pool=getPool();
    const mode=await pool.query('SHOW default_transaction_read_only');
    assert.equal(mode.rows[0]?.default_transaction_read_only,'on',
      'Read-only mode must be enforced by PostgreSQL, not only a UI flag');
    await assert.rejects(
      pool.query(`INSERT INTO clients(id,owner_id,legal_name,created_at,updated_at)
        VALUES($1,$2,$3,now()::text,now()::text)`,[id,'ci-owner','Forbidden RC write']),
      (error:unknown)=>typeof error==='object'&&error!==null&&
        'code' in error&&error.code==='25006',
      'PostgreSQL must deny any data write');
    const count=await pool.query('SELECT COUNT(*)::int AS n FROM clients WHERE id=$1',[id]);
    assert.equal(count.rows[0].n,0,'Rejected write cannot persist');
  }finally{
    await closeDatabase();
    if(previousEnv===undefined)delete process.env.RAILWAY_ENVIRONMENT_NAME;
    else process.env.RAILWAY_ENVIRONMENT_NAME=previousEnv;
    if(previousFlag===undefined)delete process.env.CISNE_STAGING_READ_ONLY;
    else process.env.CISNE_STAGING_READ_ONLY=previousFlag;
  }
});
