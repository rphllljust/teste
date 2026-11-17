// Published OCI digest -> real Prisma/Postgres -> HMAC -> SigV4 -> private S3.
// Only ephemeral GitHub Actions; never expose a presigned URL in evidence.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {signBridgeRequest,verifyBridgeResponse,NEXTCRM_BRIDGE_PATH} from '../lib/integrations/nextcrm/bridge-protocol.ts';
assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.equal(process.env.CI,'true');
assert.ok(!Object.keys(process.env).some(k=>k.startsWith('RAILWAY_')));
const fixture=JSON.parse(await readFile('/tmp/rc82-fixture.json','utf8'));
const secret=process.env.CI_RC82_BRIDGE_SECRET;
const phase=process.env.RC82_PHASE??'positive';
const endpoint='http://127.0.0.1:13100'+NEXTCRM_BRIDGE_PATH;
async function authorize(options={}){
  const body=JSON.stringify({
    documentId:fixture.documentId,subjectId:fixture.owner,
    accountId:fixture.accountId,erpClientId:fixture.erpClientId,
    tenantKey:fixture.instanceKey,requestId:randomUUID(),
    purpose:'file',...(options.changes??{}),
  });
  const proof=signBridgeRequest(secret,body);
  const response=await fetch(endpoint,{method:'POST',redirect:'error',
    headers:{'content-type':'application/json',
      'x-cisne-bridge-timestamp':proof.timestamp,
      'x-cisne-bridge-nonce':proof.nonce,
      'x-cisne-bridge-signature':options.forge?'v1='+'0'.repeat(64):proof.signature},
    body});
  const raw=await response.text();
  if(!options.forge)assert.equal(
    verifyBridgeResponse(secret,raw,response.status,proof,
      response.headers.get('x-cisne-bridge-response-signature')??''),
    true,'Private NextCRM reply must be signed');
  return {status:response.status,body:JSON.parse(raw)};
}
let facts;
if(phase==='positive'){
  const issued=await authorize();
  assert.equal(issued.status,200);
  assert.equal(issued.body.authorized,true);
  assert.equal(issued.body.sha256,fixture.sha256);
  assert.equal(issued.body.expiresIn,60);
  assert.equal(issued.body.version,1);
  const ticket=new URL(issued.body.fileUrl);
  assert.equal(ticket.origin,'https://nextcrm-minio-staging.up.railway.app');
  assert.ok(ticket.pathname.startsWith('/nextcrm/documents/rc82/'));
  assert.equal(ticket.searchParams.get('X-Amz-Expires'),'60');
  assert.equal(ticket.searchParams.get('X-Amz-Algorithm'),'AWS4-HMAC-SHA256');
  assert.match(ticket.searchParams.get('X-Amz-Signature')??'',/^[a-f0-9]{64}$/i);
  const file=await fetch(ticket,{redirect:'error'});
  assert.equal(file.status,200,'Signed GET must return real private object bytes');
  const bytes=Buffer.from(await file.arrayBuffer());
  assert.equal(bytes.length,fixture.size);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),fixture.sha256);
  const unsigned=await fetch(ticket.origin+ticket.pathname,{redirect:'error'});
  assert.equal(unsigned.status,403,'Anonymous MinIO object must not be public');
  const forged=await authorize({forge:true});
  assert.equal(forged.status,401);
  const outsider=await authorize({changes:{subjectId:fixture.outsider}});
  assert.equal(outsider.status,404);
  const foreign=await authorize({changes:{erpClientId:randomUUID()}});
  assert.equal(foreign.status,404);
  const gateway=await fetch('http://127.0.0.1:13180'+NEXTCRM_BRIDGE_PATH,{
    method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(gateway.status,404,'Public gateway must not serve the internal bridge');
  assert.equal(gateway.headers.get('x-cisne-bridge-response-signature'),null);
  const metadata=await authorize({changes:{purpose:undefined}});
  assert.equal(metadata.status,200);
  assert.equal(metadata.body.fileUrl,undefined,'Metadata must never expose S3 URL');
  facts={ticket:200,signedGet:200,sha256:'matched',size:bytes.length,
    anonymousMinio:403,forgedHmac:401,outsider:404,wrongClient:404,
    gatewayBridge:404,metadataLeakedUrl:false};
  console.log('RC82_PUBLISHED_IMAGE_REAL_DOCUMENT_DOWNLOAD_PASS');
}else if(phase==='revoked'){
  const denied=await authorize();
  assert.equal(denied.status,404,'Revoked link must block new tickets');
  facts={newTicketAfterRevocation:404,knownLimitation:
    'Existing signed URLs continue until their 60-second expiry; new requests are denied'};
  console.log('RC82_REAL_DOCUMENT_ACL_REVOCATION_PASS');
}else throw Error('Unknown RC82 phase');
await mkdir('artifacts/rc82',{recursive:true});
await writeFile('artifacts/rc82/'+phase+'.json',JSON.stringify({
  imageDigest:'sha256:d32fe18e9589d252a5061f16c29d498b15a2d989a3223d9e897f3a928ff8b2ca',
  publishedSource:'c4273a4f1382417ddfef7f4b0e32e7123288835d',
  environment:'isolated synthetic GitHub Actions, not Railway UAT/production',
  phase,results:facts},null,2));
