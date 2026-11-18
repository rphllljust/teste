import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {closeDatabase} from '../../db/raw';
import {GET as peopleGET} from '../../app/api/field/people/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
  throw Error('FIELD_STAFF_NO_GO: disposable CI database required');
const target=new URL(process.env.DATABASE_URL);
if(!['127.0.0.1','localhost'].includes(target.hostname)||
  !['/cisne_ci','/cisne_test'].includes(target.pathname)||target.port!=='5432')
  throw Error('FIELD_STAFF_NO_GO: refusing non-disposable PostgreSQL');
const owner=randomUUID(),other=randomUUID();
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});
const req=(actor:string,path:string)=>setTestIdentity(new Request('http://localhost'+path),actor);
after(async()=>{
  try{await pool.query('DELETE FROM field_people WHERE owner_id=$1',[owner]);}
  finally{await closeDatabase();await pool.end();}
});

test('PostgreSQL staff registry pages and literal text search remain owner-scoped',async()=>{
  const ids=Array.from({length:103},()=>randomUUID());
  await pool.query(
    "INSERT INTO field_people(id,owner_id,full_name,specialty,request_hash) SELECT p.id,$2,'Colaborador '||lpad(p.n::text,3,'0'),'Técnico de campo',$3 FROM unnest($1::text[]) WITH ORDINALITY AS p(id,n)",
    [ids,owner,'a'.repeat(64)],
  );
  const special=randomUUID();
  await pool.query(
    "INSERT INTO field_people(id,owner_id,full_name,specialty,request_hash) VALUES($1,$2,'Ana % Especial','Engenharia de campo',$3)",
    [special,owner,'a'.repeat(64)],
  );
  const first=await peopleGET(req(owner,'/api/field/people?page=1'));
  assert.equal(first.status,200);
  const a=await first.json() as {items:Array<{id:string}>;pageInfo:{page:number;hasMore:boolean}};
  assert.equal(a.items.length,100);
  assert.deepEqual(a.pageInfo,{page:1,hasMore:true});
  const second=await peopleGET(req(owner,'/api/field/people?page=2'));
  assert.equal(second.status,200);
  const b=await second.json() as typeof a;
  assert.equal(b.items.length,4);
  assert.deepEqual(b.pageInfo,{page:2,hasMore:false});
  const filtered=await peopleGET(req(owner,'/api/field/people?q=%25'));
  assert.equal(filtered.status,200);
  const c=await filtered.json() as typeof a;
  assert.deepEqual(c.items.map(item=>item.id),[special],'percent sign must be searched literally');
  const otherResponse=await peopleGET(req(other,'/api/field/people?q=T%C3%A9cnico'));
  assert.equal(otherResponse.status,200);
  assert.deepEqual((await otherResponse.json() as typeof a).items,[]);
  assert.equal((await peopleGET(req(owner,'/api/field/people?page=0'))).status,400);
  assert.equal((await peopleGET(req(owner,'/api/field/people?q='+ 'x'.repeat(161)))).status,400);
});
