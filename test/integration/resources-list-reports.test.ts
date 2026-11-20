import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {closeDatabase} from '../../db/raw';
import {GET as assets} from '../../app/api/assets/route';
import {GET as professionals} from '../../app/api/professionals/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
 throw new Error('Resource List Reports require isolated PostgreSQL');
const url=new URL(process.env.DATABASE_URL);
if(!['127.0.0.1','localhost'].includes(url.hostname)||url.port!=='5432'||
 !['/cisne_test','/cisne_ci'].includes(url.pathname))
 throw new Error('Refusing resource List Report integration outside local CI');
function req(path:string,actor:string){
 return setTestIdentity(new Request('http://localhost'+path),actor);
}
test('Assets and Professionals use bounded real SQL paging, sort, filters and tenant isolation',async()=>{
 const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});
 const owner=randomUUID(),other=randomUUID(),assetIds:string[]=[],professionalIds:string[]=[];
 const foreignAsset=randomUUID(),foreignProfessional=randomUUID();
 try{
  const now=new Date().toISOString();
  for(let i=0;i<27;i++){
   const asset=randomUUID(),person=randomUUID(),n=String(i).padStart(2,'0');
   assetIds.push(asset);professionalIds.push(person);
   await pool.query("INSERT INTO assets(id,owner_id,code,name,kind,status,location,responsible,hourly_cost,created_at,updated_at) VALUES($1,$2,$3,$4,'vehicle','active',NULL,NULL,$5,$6,$6)",
    [asset,owner,'CI-A-'+n,'Asset '+n,100+i,now]);
   await pool.query("INSERT INTO professionals(id,owner_id,name,registration,specialty,department,status,phone,hourly_cost,created_at,updated_at) VALUES($1,$2,$3,$4,'Técnico','Field','active',NULL,$5,$6,$6)",
    [person,owner,'Professional '+n,'CI-P-'+n,100+i,now]);
  }
  await pool.query("INSERT INTO assets(id,owner_id,code,name,kind,status,hourly_cost,created_at,updated_at) VALUES($1,$2,'CI-OTHER-A','Another Owner','vehicle','active',999,$3,$3)",[foreignAsset,other,now]);
  await pool.query("INSERT INTO professionals(id,owner_id,name,registration,specialty,department,status,hourly_cost,created_at,updated_at) VALUES($1,$2,'Another Owner','CI-OTHER-P','Tech','Field','active',999,$3,$3)",[foreignProfessional,other,now]);
  for(const [label,handler,ids,base] of [
    ['assets',assets,assetIds,'/api/assets'],
    ['professionals',professionals,professionalIds,'/api/professionals'],
  ] as const){
   const desc=await handler(req(base+'?page=1&pageSize=25&sort=hourlyCost.desc',owner));
   assert.equal(desc.status,200,label);
   const body=await desc.json() as {items:Array<{id:string;hourlyCost:number}>;
    pageInfo:{total:number;hasMore:boolean}};
   assert.equal(body.pageInfo.total,27,label);
   assert.equal(body.pageInfo.hasMore,true,label);
   assert.equal(body.items.length,25,label);
   assert.equal(body.items[0].id,ids[26],label);
   assert.equal(body.items[0].hourlyCost,126,label);
   const next=await handler(req(base+'?page=2&pageSize=25&sort=hourlyCost.desc',owner));
   const second=await next.json() as typeof body;
   assert.equal(second.items.length,2,label);
   assert.equal(second.pageInfo.hasMore,false,label);
   const ascending=await handler(req(base+'?sort=name.asc&page=1',owner));
   assert.equal(((await ascending.json()) as typeof body).items[0].id,ids[0],label);
   const ownerResponse=await handler(req(base+'?q=Another%20Owner',owner));
   assert.equal(((await ownerResponse.json()) as typeof body).items.length,0,label);
   assert.equal((await handler(req(base+'?sort=owner_id.desc',owner))).status,400,label);
  }
  assert.equal((await assets(req('/api/assets?sort=code.asc',owner))).status,200);
  assert.equal((await professionals(req('/api/professionals?sort=registration.asc',owner))).status,200);
  const fromOther=await professionals(req('/api/professionals?sort=name.asc',other));
  const otherData=await fromOther.json() as {items:Array<{id:string}>};
  assert.deepEqual(otherData.items.map(x=>x.id),[foreignProfessional]);
 }finally{
  await pool.query('DELETE FROM assets WHERE id=ANY($1::text[])',[...assetIds,foreignAsset]);
  await pool.query('DELETE FROM professionals WHERE id=ANY($1::text[])',[...professionalIds,foreignProfessional]);
  await closeDatabase();await pool.end();
 }
});
