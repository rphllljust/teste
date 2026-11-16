import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { closeDatabase } from '../../db/raw';
import { GET as getOrderDetail } from '../../app/api/orders/[id]/route';
import { setTestIdentity } from '../../lib/api/test-identity.mjs';
import { NEXTCRM_BRIDGE_PATH, verifyBridgeRequest, signBridgeResponse } from '../../lib/integrations/nextcrm/bridge-protocol';
import { createPostgresNextcrmLinkDependencies } from '../../lib/integrations/nextcrm/postgres-mapped-dependencies';
import { authorizeAndPersistOrderDocumentLink } from '../../lib/integrations/nextcrm/postgres-document-link';
import { OrderDocumentLinkDenied } from '../../lib/integrations/nextcrm/document-link-preflight';

if (process.env.NODE_ENV!=='test'||!process.env.DATABASE_URL)throw new Error('No real environment allowed');
const url=new URL(process.env.DATABASE_URL);
if(!['localhost','127.0.0.1'].includes(url.hostname)||!['/cisne_test','/cisne_ci'].includes(url.pathname))throw new Error('Non-ephemeral DB prohibited');
test('mapped ERP identity + client + signed HTTP authorization + persisted document, all fail closed',async()=>{
  const pool=new Pool({connectionString:process.env.DATABASE_URL,max:4});
  const owner=randomUUID(),foreign=randomUUID(),clientId=randomUUID(),orderId=randomUUID();
  const subject=randomUUID(),account=randomUUID(),document=randomUUID();
  const measurement=randomUUID(),invoice=randomUUID(),receivable=randomUUID(),receipt=randomUUID();
  const instanceKey='cisne-hml-mapping-ci',secret=randomBytes(32).toString('hex'),now=new Date().toISOString();
  let calls=0;
  let revokeIdentityDuringSignedResponse=false;
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
    if(allowed&&revokeIdentityDuringSignedResponse){
      revokeIdentityDuringSignedResponse=false;
      // Simulates operator revocation AFTER preflight but BEFORE ERP SQL insert.
      await pool.query('UPDATE nextcrm_erp_identity_mappings SET active=false WHERE erp_actor_id=$1',[owner]);
    }
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
    // Synthetic financial facts belong to the EXACT OS used by the signed
    // NextCRM document bridge. Nothing is written to Railway databases.
    await pool.query('INSERT INTO measurements(id,order_id,description,amount,status,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      [measurement,orderId,'Integrated CI measurement',120000,'approved',now]);
    await pool.query('INSERT INTO invoices(id,measurement_id,order_id,amount,due_date,created_at) VALUES($1,$2,$3,$4,$5,$6)',
      [invoice,measurement,orderId,120000,'2026-12-01',now]);
    await pool.query('INSERT INTO receivables(id,invoice_id,amount,due_date,created_at) VALUES($1,$2,$3,$4,$5)',
      [receivable,invoice,120000,'2026-12-01',now]);
    await pool.query(`INSERT INTO receivable_settlements
      (id,receivable_id,kind,amount,effective_date,reference,created_at,actor_id,request_hash,correlation_id)
      VALUES($1,$2,'receipt',$3,$4,$5,$6,$7,$8,$9)`,
      [receipt,receivable,45000,'2026-11-16','CI combined receipt',now,owner,'f'.repeat(64),randomUUID()]);
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

    // Integrated business-chain gate: the very same OS must have a
    // persisted NextCRM link AND an owner-scoped Financeiro ledger, while
    // the browser-facing OS response must never disclose bridge secrets,
    // upstream CRM identifiers or private download URLs.
    const detailFor=(actor:string)=>getOrderDetail(
      setTestIdentity(new Request('http://localhost/api/orders/'+orderId),actor),
      {params:Promise.resolve({id:orderId})},
    );
    const detail=await detailFor(owner);
    assert.equal(detail.status,200);
    assert.equal(detail.headers.get('cache-control'),'no-store');
    const json=await detail.json() as {order:{
      id:string;relations:{measurements:number;invoices:number;receivables:number};
      finance:{measuredScaled:string;invoicedScaled:string;receivableScaled:string;
        settledScaled:string;outstandingScaled:string;moneyScale:number;
        bankBalanceAvailable:boolean;authority:string};
    }};
    assert.equal(json.order.id,orderId);
    assert.deepEqual(json.order.relations,{clientId,contractId:null,measurements:1,invoices:1,receivables:1});
    assert.deepEqual([
      json.order.finance.measuredScaled,json.order.finance.invoicedScaled,
      json.order.finance.receivableScaled,json.order.finance.settledScaled,
      json.order.finance.outstandingScaled,
    ],['120000','120000','120000','45000','75000']);
    assert.equal(json.order.finance.moneyScale,4);
    assert.equal(json.order.finance.bankBalanceAvailable,false);
    assert.equal(json.order.finance.authority,'field.persistedReceivableSettlementLedger.v1');
    const linked=await pool.query(
      'SELECT id,owner_id,nextcrm_document_id FROM nextcrm_order_document_links WHERE service_order_id=$1',
      [orderId],
    );
    assert.equal(linked.rowCount,1);
    assert.equal(linked.rows[0].owner_id,owner);
    assert.equal(linked.rows[0].nextcrm_document_id,document);
    const publicJson=JSON.stringify(json);
    for(const forbidden of [subject,account,document,secret,'railway.internal','http://','s3://']){
      assert.equal(publicJson.includes(forbidden),false,'Do not expose NextCRM private bridge facts in OS detail');
    }
    assert.equal((await detailFor(foreign)).status,404,'Foreign owner cannot see finance/document OS context');
    revokeIdentityDuringSignedResponse=true;
    await assert.rejects(()=>persist(),(e:unknown)=>e instanceof OrderDocumentLinkDenied,
      'Revocation during signed response must deny even an otherwise idempotent retry');
    assert.equal(calls,2,'Signed authorization was attempted after initially approved mapping');
    // Revocation affects future links, never erases the independent
    // Financeiro ledger or the immutable documentary evidence.
    const unchanged=await pool.query('SELECT count(*)::int AS n FROM nextcrm_order_document_links WHERE service_order_id=$1',[orderId]);
    assert.equal(unchanged.rows[0].n,1,'Revoked identity must never add another persisted link');
    await pool.query('UPDATE nextcrm_erp_identity_mappings SET active=true WHERE erp_actor_id=$1',[owner]);
    await assert.rejects(()=>persist(foreign),(e:unknown)=>e instanceof OrderDocumentLinkDenied);
    assert.equal(calls,2,'Foreign user blocked before NextCRM');
    await pool.query('UPDATE nextcrm_erp_client_account_mappings SET active=false WHERE erp_client_id=$1',[clientId]);
    await assert.rejects(()=>persist(),(e:unknown)=>e instanceof OrderDocumentLinkDenied);
    assert.equal(calls,2,'Disabled mapping blocked before NextCRM');
    await pool.query('UPDATE nextcrm_erp_client_account_mappings SET active=true,erp_owner_id=$1 WHERE erp_client_id=$2',[foreign,clientId]);
    await assert.rejects(()=>persist(),(e:unknown)=>e instanceof OrderDocumentLinkDenied);
    assert.equal(calls,2,'Foreign owner mapping blocked before NextCRM');
  } finally {
    await pool.end();
    await closeDatabase();
    await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
  }
});
