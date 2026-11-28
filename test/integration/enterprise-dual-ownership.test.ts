import test from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {closeDatabase} from '../../db/raw';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {GET as getOwners} from '../../app/api/enterprise/owners/route';
if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)throw new Error('Disposable PostgreSQL required for owners test');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});
test('two declared owners persist and are not assigned to unverified user IDs',async()=>{
 try{
  const anonymous=await getOwners(new Request('http://localhost/api/enterprise/owners'));
  assert.equal(anonymous.status,401);
  const response=await getOwners(setTestIdentity(new Request('http://localhost/api/enterprise/owners'),randomUUID()));
  assert.equal(response.status,200);
  const payload=await response.json() as {items:Array<{displayName:string;declaredRole:string;identityState:string}>;total:number};
  assert.equal(payload.total,2);
  assert.deepEqual(payload.items.map(x=>[x.displayName,x.declaredRole,x.identityState]),[
   ['Abrahim','owner','unlinked'],['Rafael','owner','unlinked']]);
  assert.ok(payload.items.every(x=>!('identityActorId' in x)));
  const r=await pool.query("SELECT COUNT(*)::integer AS count FROM cisne_erp_owner_declarations WHERE identity_actor_id IS NULL AND identity_state='unlinked' AND declared_role='owner'");
  assert.equal(r.rows[0].count,2);
 }finally{await closeDatabase();await pool.end();}
});
