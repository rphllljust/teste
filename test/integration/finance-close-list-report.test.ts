import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {closeDatabase} from '../../db/raw';
import {GET,POST} from '../../app/api/finance/periods/close/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
 throw new Error('Financial closing List Report requires disposable PostgreSQL');
const target=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(target.hostname)||
 !['/cisne_test','/cisne_ci'].includes(target.pathname)||target.port!=='5432')
 throw new Error('Refusing financial test on non-CI database');
const owner=randomUUID(),outsider=randomUUID(),firstId=randomUUID();
const ids=[firstId,...Array.from({length:26},()=>randomUUID())];
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});
function req(method:'GET'|'POST',path:string,actor:string,data?:unknown){
 return setTestIdentity(new Request('http://localhost'+path,{
  method,headers:{'content-type':'application/json'},
  ...(data===undefined?{}:{body:JSON.stringify(data)}),
 }),actor);
}
test('financial periods execute SQL sorting, owner-scoped search, true pagination and reject invalid filters',async()=>{
 let foreign='';
 try{
  const created=await POST(req('POST','/api/finance/periods/close',owner,{
   id:firstId,periodStart:'2098-02-01',periodEnd:'2098-02-01',reference:'Auditoria ABC especial',
  }));
  assert.equal(created.status,201,JSON.stringify(await created.clone().json()));
  for(let day=1;day<=26;day++){
   const id=ids[day],iso='2098-01-'+String(day).padStart(2,'0');
   await pool.query("INSERT INTO finance_period_closes (id,period_start,period_end,status,actor_id,request_hash,correlation_id,closed_at) VALUES($1,$2,$2,'closed',$3,$4,$5,$6)",
    [id,iso,owner,randomUUID(),randomUUID(),new Date(iso+'T12:00:00Z')]);
  }
  foreign=randomUUID();
  await pool.query("INSERT INTO finance_period_closes (id,period_start,period_end,status,actor_id,request_hash,correlation_id,closed_at) VALUES($1,'2098-03-01','2098-03-01','closed',$2,$3,$4,$5)",
   [foreign,outsider,randomUUID(),randomUUID(),new Date('2098-03-01T12:00:00Z')]);
  const first=await GET(req('GET','/api/finance/periods/close?page=1&sort=periodEnd.desc',owner));
  assert.equal(first.status,200);
  const data=await first.json() as {items:{id:string;reference:string}[];
   pageInfo:{page:number;total:number;hasMore:boolean}};
  assert.equal(data.pageInfo.total,27);
  assert.equal(data.pageInfo.hasMore,true);
  assert.equal(data.items.length,25);
  assert.equal(data.items[0].id,firstId);
  assert.equal(data.items.some(row=>row.id===foreign),false);
  const next=await GET(req('GET','/api/finance/periods/close?page=2&sort=periodEnd.desc',owner));
  const second=await next.json() as typeof data;
  assert.equal(second.pageInfo.total,27);
  assert.equal(second.pageInfo.hasMore,false);
  assert.equal(second.items.length,2);
  const ascending=await GET(req('GET','/api/finance/periods/close?sort=periodEnd.asc',owner));
  assert.equal(((await ascending.json()) as typeof data).items[0].id,ids[1]);
  const search=await GET(req('GET','/api/finance/periods/close?q=ABC',owner));
  const searched=await search.json() as typeof data;
  assert.equal(searched.pageInfo.total,1);
  assert.deepEqual(searched.items.map(x=>x.id),[firstId]);
  assert.equal(searched.items[0].reference,'Auditoria ABC especial');
  const filtered=await GET(req('GET','/api/finance/periods/close?from=2098-01-22&to=2098-01-24',owner));
  assert.equal(((await filtered.json()) as typeof data).pageInfo.total,3);
  for(const invalid of ['sort=owner_id','page=-1','from=2098-02-30','from=2098-02-02&to=2098-01-01']){
   assert.equal((await GET(req('GET','/api/finance/periods/close?'+invalid,owner))).status,400,invalid);
  }
  const anonymous=await GET(new Request('http://localhost/api/finance/periods/close'));
  assert.equal(anonymous.status,401);
  const foreignCheck=await GET(req('GET','/api/finance/periods/close?q=ABC',outsider));
  assert.equal(((await foreignCheck.json()) as typeof data).pageInfo.total,0);
 }finally{
  await pool.query("DELETE FROM finance_audit_events WHERE entity_type='finance_period' AND entity_id=ANY($1::text[])",[ids]);
  await pool.query('DELETE FROM finance_period_closes WHERE id=ANY($1::text[])',[foreign?[...ids,foreign]:ids]);
  await closeDatabase();await pool.end();
 }
});
