import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { closeDatabase } from '../../db/raw';
import { setTestIdentity } from '../../lib/api/test-identity.mjs';
import { GET, POST } from '../../app/api/views/route';

if (process.env.NODE_ENV !== 'test' || !process.env.DATABASE_URL)
 throw Error('Saved-view ownership test requires isolated disposable PostgreSQL');
const pool = new Pool({connectionString:process.env.DATABASE_URL,max:2});
const actor=randomUUID(),outsider=randomUUID();
const legacyId=randomUUID(),foreignId=randomUUID(),mineId=randomUUID();
const definition={
 schemaVersion:1,entityKey:'serviceOrder',viewKey:'serviceOrders.worklist',
 filters:{query:'',category:'Todas as atividades',view:'Todas as ordens'},
 sort:'createdAt.desc',visibleColumns:['order','status'],pageSize:25,
} as const;
function req(method:'GET'|'POST',who:string,body?:unknown){
 return setTestIdentity(new Request('http://localhost/api/views',{method,
  headers:{'content-type':'application/json'},
  ...(body===undefined?{}:{body:JSON.stringify(body)})}),who);
}
function payload(id:string,name:string){
 return {id,name,query:'',category:'',view:'',definition};
}
before(async()=>{
 const now=new Date().toISOString();
 await pool.query(`INSERT INTO saved_views
 (id,name,query,category,view,created_at,owner_id,definition,schema_version,row_version,is_default,view_key)
 VALUES($1,'Legacy ownerless view','','','',$4,NULL,$5,1,1,0,'serviceOrders.worklist'),
 ($2,'Foreign sensitive view','','','',$4,$6,$5,1,1,0,'serviceOrders.worklist')`,
 [legacyId,foreignId,mineId,now,JSON.stringify(definition),outsider]);
});
after(async()=>{await closeDatabase();await pool.end();});
test('ownerless and foreign views are not visible in an authenticated list',async()=>{
 const r=await GET(req('GET',actor));
 assert.equal(r.status,200);
 const body=await r.json() as {views:Array<{id:string}>};
 assert.equal(body.views.some(v=>v.id===legacyId||v.id===foreignId),false);
});
test('foreign and orphaned view IDs cannot be used to overwrite existing content',async()=>{
 for(const id of [legacyId,foreignId]){
  const response=await POST(req('POST',actor,payload(id,'Injected owner switch')));
  assert.equal(response.status,409);
  const actual=await pool.query('SELECT owner_id,name,row_version FROM saved_views WHERE id=$1',[id]);
  assert.equal(actual.rows[0].row_version,1);
  assert.equal(actual.rows[0].name,id===legacyId?'Legacy ownerless view':'Foreign sensitive view');
  assert.equal(actual.rows[0].owner_id,id===legacyId?null:outsider);
 }
});
test('owner may create and safely update their own saved view, with version preserved',async()=>{
 const created=await POST(req('POST',actor,payload(mineId,'Owner report')));
 assert.equal(created.status,201);
 const changed=await POST(req('POST',actor,payload(mineId,'Owner report updated')));
 assert.equal(changed.status,200);
 const row=await pool.query('SELECT owner_id,name,row_version FROM saved_views WHERE id=$1',[mineId]);
 assert.equal(row.rows[0].owner_id,actor);
 assert.equal(row.rows[0].name,'Owner report updated');
 assert.equal(row.rows[0].row_version,2);
});
