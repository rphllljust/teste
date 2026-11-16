import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {setTestIdentity} from '../../lib/api/test-identity.mjs';
import {GET,POST} from '../../app/api/orders/[id]/documents/route';

if(process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)
  throw Error('NextCRM route tests only run in ephemeral PostgreSQL CI');
const url=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(url.hostname)||!['/cisne_test','/cisne_ci'].includes(url.pathname))
  throw Error('NO-GO: non-disposable PostgreSQL target');
const db=new Pool({connectionString:process.env.DATABASE_URL,max:2});
const actor=randomUUID(),outsider=randomUUID(),clientId=randomUUID(),orderId=randomUUID();
const env={
  secret:process.env.CISNE_NEXTCRM_BRIDGE_SECRET,
  instance:process.env.CISNE_NEXTCRM_INSTANCE_KEY,
};
process.env.CISNE_NEXTCRM_BRIDGE_SECRET=randomBytes(32).toString('hex');
process.env.CISNE_NEXTCRM_INSTANCE_KEY='cisne-staging-nextcrm-ci';
function req(method:'GET'|'POST',actorId?:string,body?:unknown){
  const r=new Request('http://localhost/api/orders/'+orderId+'/documents',{
    method,headers:{'content-type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  return actorId?setTestIdentity(r,actorId):r;
}
const route={params:Promise.resolve({id:orderId})};
const payload={
  key:randomUUID(),nextcrmDocumentId:randomUUID(),documentKind:'service_report',
  version:1,sha256:'a'.repeat(64),
};
after(async()=>{
  await db.query('DELETE FROM service_orders WHERE id=$1',[orderId]);
  await db.query('DELETE FROM clients WHERE id=$1',[clientId]);
  await db.end();
  if(env.secret===undefined)delete process.env.CISNE_NEXTCRM_BRIDGE_SECRET;
  else process.env.CISNE_NEXTCRM_BRIDGE_SECRET=env.secret;
  if(env.instance===undefined)delete process.env.CISNE_NEXTCRM_INSTANCE_KEY;
  else process.env.CISNE_NEXTCRM_INSTANCE_KEY=env.instance;
});
test('document route exposes only mapped and authorized ERP OS resources',async()=>{
  const now=new Date().toISOString();
  await db.query(
    'INSERT INTO clients(id,owner_id,legal_name,created_at,updated_at) VALUES($1,$2,$3,$4,$4)',
    [clientId,actor,'NextCRM document route CI',now]);
  await db.query(
    `INSERT INTO service_orders(id,owner_id,client_id,title,client,category,description,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [orderId,actor,clientId,'OS NextCRM CI','NextCRM document route CI','Serviços','Synthetic',now],
  );
  const anonymous=await GET(req('GET'),route);
  assert.equal(anonymous.status,401);
  const stranger=await GET(req('GET',outsider),route);
  assert.equal(stranger.status,404);
  const noMapping=await GET(req('GET',actor),route);
  assert.equal(noMapping.status,200);
  const contents=await noMapping.json() as {enabled:boolean;items:unknown[];reason:string};
  assert.deepEqual({enabled:contents.enabled,items:contents.items,reason:contents.reason},{
    enabled:false,items:[],reason:'IDENTITY_MAPPING_REQUIRED',
  });
  const notAuthorized=await POST(req('POST',actor,payload),route);
  assert.equal(notAuthorized.status,404,'Document linkage needs approved identity and account mappings');
  const wrongActor=await POST(req('POST',outsider,payload),route);
  assert.equal(wrongActor.status,404);
  const invalid=await POST(req('POST',actor,{...payload,ownerId:actor}),route);
  assert.equal(invalid.status,400);
  const rows=await db.query('SELECT count(*)::int AS n FROM nextcrm_order_document_links WHERE service_order_id=$1',[orderId]);
  assert.equal(rows.rows[0].n,0);
});
