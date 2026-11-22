import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {closeDatabase} from '../../db/raw';
import {GET as listInventory} from '../../app/api/inventory/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
 throw Error('DISPOSABLE_DB_REQUIRED: isolated inventory integration test');
const url=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(url.hostname)||
 url.port!=='5432'||!['/cisne_test','/cisne_ci'].includes(url.pathname))
 throw Error('DISPOSABLE_DB_REQUIRED: refusing nonlocal inventory writes');

test('inventory filters shortage by reservations, paginates 27 records on PostgreSQL, and isolates owners',async()=>{
 const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2});
 const actor=randomUUID(),stranger=randomUUID(),now=new Date().toISOString();
 const own=Array.from({length:27},(_,n)=>({id:randomUUID(),owner:actor,
  sku:'CISNE-CI-'+String(n+1).padStart(3,'0'),minimum:n===0?2000:0}));
 const foreign={id:randomUUID(),owner:stranger,sku:'CISNE-CI-FOREIGN',minimum:2000};
 const all=[...own,foreign],reservedId=randomUUID(),movementId=randomUUID();
 const auth=(path:string,owner?:string)=>{const request=new Request('http://localhost'+path);
  return owner?setTestIdentity(request,owner):request;};
 try{
  for(const item of all)
   await pool.query(
    'INSERT INTO inventory_items(id,owner_id,sku,name,unit,minimum,created_at,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [item.id,item.owner,item.sku,'Material de integração','un',item.minimum,now,randomUUID()]);
  await pool.query(
   'INSERT INTO inventory_movements(id,item_id,owner_id,delta,reference,created_at,request_hash,correlation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
   [movementId,own[0].id,actor,4000,'Entrada de CI',now,randomUUID(),randomUUID()]);
  await pool.query(
   "INSERT INTO inventory_reservations(id,item_id,owner_id,source_document_type,source_document_id,source_reference,quantity,status,created_at,request_hash,correlation_id) VALUES($1,$2,$3,'ci',$4,$5,$6,'reserved',$7,$8,$9)",
   [reservedId,own[0].id,actor,randomUUID(),'Reserva de CI',3000,now,randomUUID(),randomUUID()]);
  const first=await listInventory(auth('/api/inventory?q=CISNE-CI-&page=1&lowOnly=0',actor));
  assert.equal(first.status,200,JSON.stringify(await first.clone().json()));
  const one=await first.json() as {items:Array<{id:string;available:string|number;balance:string|number}>;
   hasMore:boolean;matched:number;page:number;summary:{total:number|string;low:number|string}};
  assert.equal(one.items.length,25);
  assert.equal(one.matched,27);
  assert.equal(one.hasMore,true);
  assert.equal(one.page,1);
  assert.equal(Number(one.summary.total),27);
  assert.equal(Number(one.summary.low),1);
  const second=await listInventory(auth('/api/inventory?q=CISNE-CI-&page=2&lowOnly=0',actor));
  const two=await second.json() as typeof one;
  assert.equal(second.status,200);
  assert.equal(two.items.length,2);
  assert.equal(two.hasMore,false);
  const urgent=await listInventory(auth('/api/inventory?lowOnly=1&page=1',actor));
  const filtered=await urgent.json() as typeof one;
  assert.equal(urgent.status,200);
  assert.equal(filtered.matched,1);
  assert.deepEqual(filtered.items.map(item=>item.id),[own[0].id]);
  assert.equal(Number(filtered.items[0].balance),4000);
  assert.equal(Number(filtered.items[0].available),1000);
  assert.equal((await listInventory(auth('/api/inventory?lowOnly=unknown',actor))).status,400);
  assert.equal((await listInventory(auth('/api/inventory'))).status,401);
  const foreignView=await listInventory(auth('/api/inventory?lowOnly=1',stranger));
  assert.equal(foreignView.status,200);
  const outsider=await foreignView.json() as typeof one;
  assert.deepEqual(outsider.items.map(item=>item.id),[foreign.id]);
  assert.equal(outsider.matched,1);
 }finally{
  await pool.query('DELETE FROM inventory_reservations WHERE id=$1',[reservedId]);
  await pool.query('DELETE FROM inventory_movements WHERE id=$1',[movementId]);
  await pool.query('DELETE FROM inventory_items WHERE id=ANY($1::text[])',[all.map(item=>item.id)]);
  await closeDatabase();await pool.end();
 }
});
