// RC83: one business chain across the REAL CISNE handlers, a published
// NextCRM OCI image, two disposable PostgreSQL databases and private MinIO.
// No Railway network, shared UAT database, customer data or permanent login.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer,request as proxyRequest} from 'node:http';
import {Pool} from 'pg';
import {setTestIdentity} from '../lib/api/test-identity.mjs';
import {closeDatabase} from '../db/raw';
import {POST as createOrder} from '../app/api/orders/route';
import {POST as runCommand} from '../app/api/commands/route';
import {GET as getOrder} from '../app/api/orders/[id]/route';
import {GET as listDocuments} from '../app/api/orders/[id]/documents/route';
import {GET as getFileBytes} from '../app/api/orders/[id]/documents/[linkId]/file/route';
import {POST as receiptHandler} from '../app/api/finance/receivables/settlements/route';
import {POST as reversalHandler} from '../app/api/finance/receivables/settlements/[id]/reverse/route';
import {POST as closeHandler} from '../app/api/finance/periods/close/route';
import {createPostgresNextcrmLinkDependencies} from '../lib/integrations/nextcrm/postgres-mapped-dependencies';
import {authorizeAndPersistOrderDocumentLink} from '../lib/integrations/nextcrm/postgres-document-link';
import {OrderDocumentLinkDenied} from '../lib/integrations/nextcrm/document-link-preflight';

if(process.env.GITHUB_ACTIONS!=='true'||process.env.CI!=='true'||
   process.env.NODE_ENV!=='test'||process.env.RAILWAY_ENVIRONMENT_NAME!=='staging')
  throw Error('RC83 requires disposable GitHub Actions test and staging-mode route');
const url=new URL(process.env.DATABASE_URL??'about:blank');
if(url.hostname!=='127.0.0.1'||url.port!=='5432'||url.pathname!=='/cisne_ci')
  throw Error('NO-GO: RC83 only allows localhost:5432/cisne_ci');
const fixture=JSON.parse(await readFile('/tmp/rc82-fixture.json','utf8'));
const actor=randomUUID(),foreigner=randomUUID(),orderId=randomUUID();
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:3});
const remote={
  baseUrl:'http://127.0.0.1:13100',
  secret:process.env.CI_RC82_BRIDGE_SECRET,
  instanceKey:'rc82_ephemeral',
  timeoutMs:3000,
};
const persisted=[];
const prove=(event,assertions)=>persisted.push({event,...assertions});
const getCtx=(path,who=actor)=>setTestIdentity(new Request('http://localhost'+path),who);
const postCtx=(path,body,who=actor)=>setTestIdentity(new Request('http://localhost'+path,{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),
}),who);
const step=async(id,version,command,extra={})=>{
  const res=await runCommand(postCtx('/api/commands',{
    id,version,key:randomUUID(),command,...extra,
  }));
  assert.equal(res.status,201,command+': '+await res.clone().text());
  return res.json();
};
const orderDetail=async(who=actor)=>{
  const res=await getOrder(getCtx('/api/orders/'+orderId,who),
    {params:Promise.resolve({id:orderId})});
  return {status:res.status,body:await res.json()};
};
const orderParam={params:Promise.resolve({id:orderId})};
const requestDocuments=async(who=actor)=>{
  const res=await listDocuments(getCtx('/api/orders/'+orderId+'/documents',who),orderParam);
  return {status:res.status,body:await res.json()};
};
// The real app has a hardcoded private Railway DNS hostname for the bridge.
// In ephemeral CI, /etc/hosts maps ONLY that hostname to loopback. Port 3000
// proxies to the immutable published OCI image on loopback port 13100.
const bridgeProxy=createServer((incoming,outgoing)=>{
  if(incoming.headers.host!=='nextcrm-web.railway.internal:3000'){
    outgoing.writeHead(421);outgoing.end();return;
  }
  const upstream=proxyRequest({hostname:'127.0.0.1',port:13100,
    method:incoming.method,path:incoming.url,
    headers:{...incoming.headers,host:'nextcrm-web.railway.internal:3000'},
  },res=>{outgoing.writeHead(res.statusCode??502,res.headers);res.pipe(outgoing);});
  upstream.on('error',()=>{if(!outgoing.headersSent)outgoing.writeHead(502);outgoing.end();});
  incoming.pipe(upstream);
});
await new Promise((resolve,reject)=>{
  bridgeProxy.once('error',reject);
  bridgeProxy.listen(3000,'127.0.0.1',resolve);
});
try{
  const now=new Date().toISOString();
  await pool.query('INSERT INTO clients(id,owner_id,legal_name,created_at,updated_at) VALUES($1,$2,$3,$4,$4)',
    [fixture.erpClientId,actor,'RC83 Synthetic Owner',now]);
  const created=await createOrder(postCtx('/api/orders',{
    id:orderId,title:'RC83 Same OS Real NextCRM Document and Finance',
    category:'Serviços',description:'Synthetic ephemeral CI only',
    dueDate:null,clientId:fixture.erpClientId,clientVersion:1,
  }));
  assert.equal(created.status,201,await created.clone().text());
  await step(orderId,1,'authorize');
  await step(orderId,2,'start');
  await step(orderId,3,'complete');
  const measured=await step(orderId,4,'measure',{description:'RC83 real measurement',amount:'12'});
  const measurementId=measured.resource.id;
  await step(measurementId,1,'approve_measurement');
  const billed=await step(measurementId,2,'invoice',{dueDate:'2026-12-01'});
  const invoiceId=billed.resource.id,receivableId=billed.resource.receivableId;
  assert.ok(invoiceId&&receivableId,'Real handlers must persist finance lineage');

  const linkRequest={
    payload:{serviceOrderId:orderId,nextcrmDocumentId:fixture.documentId,
      documentKind:'service_report',version:1,sha256:fixture.sha256},
    trustedErpActorId:actor,idempotencyKey:randomUUID(),
    correlationId:'rc83_real_dual_db_'+randomUUID().slice(0,8),
    db:pool,
    dependencies:createPostgresNextcrmLinkDependencies(pool,actor,remote),
  };
  const persistLink=()=>authorizeAndPersistOrderDocumentLink(linkRequest);
  await assert.rejects(persistLink,e=>e instanceof OrderDocumentLinkDenied,
    'Without approved mappings no bridge call or link is allowed');

  await pool.query(
    'INSERT INTO nextcrm_erp_identity_mappings (erp_actor_id,nextcrm_subject_id,instance_key,verified_source,verified_by,verified_at,active) VALUES($1,$2,$3,$4,$5,now(),true)',
    [actor,fixture.owner,'rc82_ephemeral','rc83-ci-approval','rc83-reviewer']);
  await pool.query(
    'INSERT INTO nextcrm_erp_client_account_mappings (erp_client_id,erp_owner_id,nextcrm_account_id,instance_key,verified_source,verified_by,verified_at,active) VALUES($1,$2,$3,$4,$5,$6,now(),true)',
    [fixture.erpClientId,actor,fixture.accountId,'rc82_ephemeral','rc83-ci-approval','rc83-reviewer']);

  // Here the ERP calls the LIVE NextCRM private bridge, not a mock.
  const linked=await persistLink();
  assert.equal(linked.created,true);
  const retry=await persistLink();
  assert.equal(retry.created,false);
  assert.equal(retry.id,linked.id);
  const same=await pool.query(
    'SELECT count(*)::int AS n FROM nextcrm_order_document_links WHERE service_order_id=$1',
    [orderId]);
  assert.equal(same.rows[0].n,1);
  prove('same_order_doc_link',{idempotency:true,rows:1,provider:'published-nextcrm-oci'});

  const listed=await requestDocuments();
  assert.equal(listed.status,200,JSON.stringify(listed.body));
  assert.equal(listed.body.enabled,true);
  assert.equal(listed.body.items.length,1);
  // The real CISNE file route re-checks both ERP ownership and NextCRM ACL,
  // gets a signed private S3 ticket, streams bytes, and verifies SHA256.
  const file=await getFileBytes(
    getCtx('/api/orders/'+orderId+'/documents/'+linked.id+'/file'),
    {params:Promise.resolve({id:orderId,linkId:linked.id})});
  assert.equal(file.status,200,'ERP file proxy '+await file.clone().text().then(x=>x.slice(0,180)));
  assert.equal(file.headers.get('cache-control'),'private, no-store');
  assert.equal(file.headers.get('content-type'),'application/octet-stream');
  assert.equal(file.headers.get('referrer-policy'),'no-referrer');
  assert.equal(file.headers.get('x-content-type-options'),'nosniff');
  const bytes=Buffer.from(await file.arrayBuffer());
  assert.equal(bytes.length,fixture.size);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),fixture.sha256);
  prove('real_erp_proxy_document_bytes',{http:200,sha256Verified:true,bytes:bytes.length,
    noPrivateTicketExposed:true});

  const foreignDoc=await requestDocuments(foreigner);
  assert.equal(foreignDoc.status,404);
  const foreignFile=await getFileBytes(
    getCtx('/api/orders/'+orderId+'/documents/'+linked.id+'/file',foreigner),
    {params:Promise.resolve({id:orderId,linkId:linked.id})});
  assert.equal(foreignFile.status,404);
  const privateOrder=await orderDetail(foreigner);
  assert.equal(privateOrder.status,404);

  const before=await orderDetail();
  assert.equal(before.status,200);
  assert.equal(before.body.order.finance.measuredScaled,'120000');
  assert.equal(before.body.order.finance.invoicedScaled,'120000');
  assert.equal(before.body.order.finance.receivableScaled,'120000');
  assert.equal(before.body.order.finance.settledScaled,'0');
  const settlementPath='/api/finance/receivables/settlements';
  const receiptKey=randomUUID(),receipt={
    receivableId,amount:'25000',effectiveDate:'2026-11-16',
    reference:'RC83 linked-document partial receipt',commandKey:receiptKey,
  };
  const deniedForeign=await receiptHandler(postCtx(settlementPath,receipt,foreigner));
  assert.equal(deniedForeign.status,404);
  const settled=await receiptHandler(postCtx(settlementPath,receipt));
  assert.equal(settled.status,201,await settled.clone().text());
  const replay=await receiptHandler(postCtx(settlementPath,receipt));
  assert.equal(replay.status,200,'Receipt replay does not post duplicate money');
  const afterReceipt=await orderDetail();
  assert.equal(afterReceipt.body.order.finance.settledScaled,'25000');
  assert.equal(afterReceipt.body.order.finance.outstandingScaled,'95000');
  const reversePath=settlementPath+'/'+receiptKey+'/reverse';
  const reversed=await reversalHandler(postCtx(reversePath,{
    commandKey:randomUUID(),effectiveDate:'2026-11-17',
    reference:'RC83 linked-document receipt reversal',
  }),{params:Promise.resolve({id:receiptKey})});
  assert.equal(reversed.status,201,await reversed.clone().text());
  const afterReverse=await orderDetail();
  assert.equal(afterReverse.body.order.finance.settledScaled,'0');
  assert.equal(afterReverse.body.order.finance.outstandingScaled,'120000');
  const closed=await closeHandler(postCtx('/api/finance/periods/close',{
    id:randomUUID(),periodStart:'2026-11-01',periodEnd:'2026-11-30',
    reference:'RC83 linked-document period closure',
  }));
  assert.equal(closed.status,201,await closed.clone().text());
  const retroactive=await receiptHandler(postCtx(settlementPath,{
    ...receipt,commandKey:randomUUID(),reference:'RC83 prohibited post-close',
  }));
  assert.equal(retroactive.status,409);
  prove('same_os_finance_http_handler_chain',{measured:120000,invoiced:120000,
    receivable:120000,receipt:25000,replay:200,reversal:201,retroactiveDenied:409,
    foreignMutationDenied:404});

  // Simulate actual NextCRM ACL revocation in the isolated PG17 only.
  // No public or production DBs are involved.
  const revoke=await fetch('http://127.0.0.1:13190/revoke',{
    method:'POST',headers:{'content-type':'application/json',
      'x-rc83-revoke-key':process.env.CI_RC83_REVOKE_KEY},
    body:JSON.stringify({documentId:fixture.documentId,accountId:fixture.accountId}),
  });
  assert.equal(revoke.status,204,'Ephemeral revoker must remove exact CRM ACL link');
  const afterRevoke=await requestDocuments();
  assert.equal(afterRevoke.status,200);
  assert.equal(afterRevoke.body.items.length,0,'Revoked doc must vanish from ERP list');
  const fileDenied=await getFileBytes(
    getCtx('/api/orders/'+orderId+'/documents/'+linked.id+'/file'),
    {params:Promise.resolve({id:orderId,linkId:linked.id})});
  assert.equal(fileDenied.status,404,'ERP byte proxy must reject revoked doc');
  prove('cross_db_document_revocation',{nextcrmLinkRemoved:true,erpListEmpty:true,
    newErpDownloadDenied:404,existingS3TicketMaySurviveUpToSeconds:60});
  // Metadata and ledger remain auditable; revoked document access is not.
  const audit=await pool.query(
    'SELECT count(*)::int AS n FROM nextcrm_order_document_events WHERE link_id=$1',
    [linked.id]);
  assert.equal(audit.rows[0].n,1);
  const post=await orderDetail();
  assert.equal(post.body.order.finance.outstandingScaled,'120000');
  const publicView=JSON.stringify(post.body);
  for(const forbidden of [fixture.owner,fixture.accountId,fixture.documentId,remote.secret,
      'X-Amz-Signature','s3://','railway.internal']){
    assert.equal(publicView.includes(forbidden),false,'No CRM data leaked from ordinary order API');
  }
  await mkdir('artifacts/rc83',{recursive:true});
  await writeFile('artifacts/rc83/dual-real-db-evidence.json',JSON.stringify({
    runSha:process.env.GITHUB_SHA??null,
    publishedNextcrmDigest:'sha256:d32fe18e9589d252a5061f16c29d498b15a2d989a3223d9e897f3a928ff8b2ca',
    scope:'Two disposable real PostgreSQL databases + signed NextCRM OCI + real MinIO, same OS',
    privacy:'Synthetic identities and bytes only. Never Railway databases.',
    evidence:persisted,
  },null,2));
  console.log('RC83_SAME_ORDER_REAL_NEXTCRM_DOCUMENT_FINANCE_REVOCATION_SUCCESS');
}finally{
  bridgeProxy.close();
  await pool.end();
  await closeDatabase();
}
