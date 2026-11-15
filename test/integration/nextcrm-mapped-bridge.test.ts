import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { NEXTCRM_BRIDGE_PATH, verifyBridgeRequest, signBridgeResponse } from '../../lib/integrations/nextcrm/bridge-protocol.ts';
import { createPostgresNextcrmLinkDependencies } from '../../lib/integrations/nextcrm/postgres-mapped-dependencies.ts';
import { authorizeAndPersistOrderDocumentLink } from '../../lib/integrations/nextcrm/postgres-document-link.ts';
import { OrderDocumentLinkDenied } from '../../lib/integrations/nextcrm/document-link-preflight.ts';

if (process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)throw new Error('No real environment allowed');
const url=new URL(process.env.DATABASE_URL);
if(url.hostname!=='127.0.0.1'||url.pathname!=='/cisne_ci')throw new Error('Non-ephemeral DB prohibited');
test('mapped ERP identity + client + signed HTTP authorization + persisted document, all fail closed',async()=>{
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:4});
  const owner=randomUUID(),foreign=randomUUID(),clientId=randomUUID(),orderId=randomUUID();
  const subject=randomUUID(),account=randomUUID(),document=randomUUID();
  const instanceKey='cisne-hml-mapping-ci',secret=randomBytes(32).toString('hex'),now=new Date().toISOString();
  let calls=0;
  const server=createServer(async(req,res)=>{
    calls++;
    const chunks:Buffer[]=[];
    for await(const chunk of req)chunks.push(Buffer.from(chunk));
    const body=Buffer.concat(chunks).toString('utf8');
    const proof={
      timestamp:String(req.headers['x-cisne-bridge-timestamp']??''),
      nonce:String(req.headers['x-cisne-bridge-nonce']??''),
      signature:String(req.headers['x-cisne-bridge-signature']??''),
    };
    if(req.method!=='POST'||req.url!==NEXTCRM_BRIDGE_PATH||!verifyBridgeRequest(secret,body,proof)){
      res.writeHead(401);res.end();return;
    }
    const b=JSON.parse(body) as Record<string,string>;
    const allowed=b.documentId===document&&b.subjectId===subject&&b.accountId===account&&
      b.erpClientId===clientId&&b.tenantKey===instanceKey;
    const code=allowed?200:404;
    const payload=JSON.stringify(allowed?
      {authorized:true,id:document,accountId:account,tenantKey:instanceKey,version:1,sha256:'a'.repeat(64)}:
      {authorized:false});
    res.writeHead(code,{'content-type':'application/json',
      'x-cisne-bridge-response-signature':signBridgeResponse(secret,payload,code,proof)});
    res.end(payload);
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const addr=server.address();
  if(!addr||typeof addr==='string')throw new Error('No loopback listener');
  const config={baseUrl:'http://127.0.0.1:'+addr.port,secret,instanceKey,timeoutMs:1200};
  const request={
    payload:{serviceOrderId:orderId,nextcrmDocumentId:document,documentKind:'service_report',version:1,sha256:'a'.repeat(64)},
    db:pool,idempotencyKey:randomUUID(),correlationId:'ci-bridge-map-001',
  };
  const persist=(actor=owner)=>authorizeAndPersistOrderDocumentLink({
    ...request,trustedErpActorId:actor,
    dependencies:createPostgresNextcrmLinkDependencies(pool,actor,config),
  });
  try{
    await pool.query('INSERT INTO clients(id,owner_id,legal_name,created_at,updated_at) VALUES($1,$2,$3,$4,$4)',
      [clientId,owner,'Synthetic mapped client',now]);
    await pool.query(`INSERT INTO service_orders(id,owner_id,client_id,title,client,category,description,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [orderId,owner,clientId,'Mapped CI OS','Synthetic mapped client','Serviços','CI only',now]);
    await assert.rejects(()=>persist(),(e:unknown)=>e instanceof OrderDocumentLinkDenied);
    assert.equal(calls,0,'No external request before approved mappings');
    await pool.query(`INSERT INTO nextcrm_erp_identity_mappings
      (erp_actor_id,nextcrm_subject_id,instance_key,verified_source,verified_by,verified_at)
      VALUES($1,$2,$3,$4,$5,now())`,
      [owner,subject,instanceKey,'ci-synthetic-approval','ci-reviewer']);
    await pool.query(`INSERT INTO nextcrm_erp_client_account_mappings
      (erp_client_id,erp_owner_id,nextcrm_account_id,instance_key,verified_source,verified_by,verified_at)
      VALUES($1,$2,$3,$4,$5,$6,now())`,
      [clientId,owner,account,instanceKey,'ci-synthetic-approval','ci-reviewer']);
    await assert.rejects(()=>persist(),(e:unknown)=>e instanceof OrderDocumentLinkDenied);
    assert.equal(calls,0,'Mappings default inactive');
    await pool.query('UPDATE nextcrm_erp_identity_mappings SET active=true WHERE erp_actor_id=$1',[owner]);
    await pool.query('UPDATE nextcrm_erp_client_account_mappings SET active=true WHERE erp_client_id=$1',[clientId]);
    const stored=await persist();
    assert.equal(stored.created,true);
    assert.equal(calls,1);
    const result=await pool.query('SELECT COUNT(*)::int AS n FROM nextcrm_order_document_events WHERE link_id=$1',[stored.id]);
    assert.equal(result.rows[0].n,1,'Audited one persisted link');
    await assert.rejects(()=>persist(foreign),(e:unknown)=>e instanceof OrderDocumentLinkDenied);
    assert.equal(calls,1,'Foreign user blocked before NextCRM');
    await pool.query('UPDATE nextcrm_erp_client_account_mappings SET active=false WHERE erp_client_id=$1',[clientId]);
    await assert.rejects(()=>persist(),(e:unknown)=>e instanceof OrderDocumentLinkDenied);
    assert.equal(calls,1,'Disabled mapping blocked before NextCRM');
    await pool.query('UPDATE nextcrm_erp_client_account_mappings SET active=true,erp_owner_id=$1 WHERE erp_client_id=$2',[foreign,clientId]);
    await assert.rejects(()=>persist(),(e:unknown)=>e instanceof OrderDocumentLinkDenied);
    assert.equal(calls,1,'Foreign owner mapping blocked before NextCRM');
  } finally {
    await pool.end();
    await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
  }
});
