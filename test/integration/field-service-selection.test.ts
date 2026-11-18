import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {closeDatabase} from '../../db/raw';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {GET as getCatalog} from '../../app/api/service-catalog/route';
import {POST as createOrder} from '../../app/api/orders/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
  throw Error('Service selection test requires isolated PostgreSQL');
const target=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(target.hostname)||
  !['/cisne_test','/cisne_ci'].includes(target.pathname)||target.port!=='5432')
  throw Error('NO-GO: refusing staging and production database in catalog test');

const db=new Pool({connectionString:process.env.DATABASE_URL});
const owner=randomUUID(),other=randomUUID(),clientId=randomUUID(),orderId=randomUUID();
const req=(who:string,path:string,method='GET',body?:unknown)=>{
  const r=new Request('http://localhost'+path,{method,
    headers:body===undefined?undefined:{'content-type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body)});
  return setTestIdentity(r,who);
};

after(async()=>{
  await db.query('DELETE FROM order_events WHERE order_id=$1',[orderId]);
  await db.query('DELETE FROM service_orders WHERE id=$1',[orderId]);
  await db.query('DELETE FROM clients WHERE id=$1',[clientId]);
  await closeDatabase();await db.end();
});

test('selecting a real company catalog service persists its FK in the service order',async()=>{
  const catalog=await getCatalog(req(owner,'/api/service-catalog'));
  assert.equal(catalog.status,200);
  const payload=await catalog.json() as {services:Array<{id:string;cnae:string;name:string}>};
  assert.ok(payload.services.length>=20,'requires the source-controlled 0006 catalog seed');
  const selected=payload.services.find(service=>service.id==='cisne-instalacao-eletrica');
  assert.ok(selected,'must select an actual active company service');
  const now=new Date().toISOString();
  await db.query(
    'INSERT INTO clients(id,owner_id,legal_name,created_at,updated_at) VALUES($1,$2,$3,$4,$4)',
    [clientId,owner,'Cliente sintético catálogo',now],
  );
  const body={
    id:orderId,title:'OS instalação elétrica sintética',category:'Serviços',
    description:'Apontamento de instalação e manutenção elétrica',dueDate:null,
    clientId,clientVersion:1,serviceCatalogId:selected!.id,
  };
  const denied=await createOrder(req(other,'/api/orders','POST',body));
  assert.equal(denied.status,404);
  const created=await createOrder(req(owner,'/api/orders','POST',body));
  assert.equal(created.status,201,JSON.stringify(await created.json()));
  const persisted=await db.query(
    'SELECT owner_id,client_id,service_catalog_id FROM service_orders WHERE id=$1',[orderId],
  );
  assert.equal(persisted.rows[0].owner_id,owner);
  assert.equal(persisted.rows[0].client_id,clientId);
  assert.equal(persisted.rows[0].service_catalog_id,selected!.id);
  const otherInvalid={...body,id:randomUUID(),serviceCatalogId:'cisne-servico-inexistente'};
  const invalid=await createOrder(req(owner,'/api/orders','POST',otherInvalid));
  assert.equal(invalid.status,400);
  const invalidPersist=await db.query('SELECT id FROM service_orders WHERE id=$1',[otherInvalid.id]);
  assert.equal(invalidPersist.rowCount,0);
});
