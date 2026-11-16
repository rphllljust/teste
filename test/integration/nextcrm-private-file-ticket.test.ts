import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { signBridgeResponse, verifyBridgeRequest } from '../../lib/integrations/nextcrm/bridge-protocol';
import { requestNextcrmFileTicket } from '../../lib/integrations/nextcrm/nextcrm-private-file-ticket';
import { NextcrmBridgeUnavailable } from '../../lib/integrations/nextcrm/nextcrm-http-document-verifier';

if (process.env.NODE_ENV !== 'test') throw Error('Only the ephemeral CI fixture may run this file-ticket test');

const secret = randomBytes(32).toString('hex');
const input = {
  documentId: randomUUID(),
  subjectId: randomUUID(),
  accountId: randomUUID(),
  erpClientId: randomUUID(),
  tenantKey: 'cisne-ci-isolated',
  expectedVersion: 1,
  expectedSha256: 'a'.repeat(64),
};
const signedUrl = 'https://nextcrm-minio-staging.up.railway.app/nextcrm/documents/ci-fake.txt' +
  '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=60&X-Amz-Signature=' + 'a'.repeat(64);

function makeConfig(
  answer: (request: Record<string, unknown>) => {status:number;body:Record<string,unknown>},
  options: {forge?:boolean} = {},
) {
  let calls=0;
  const fetchImpl:typeof fetch=async (target,init)=>{
    calls++;
    assert.equal(String(target), 'http://127.0.0.1:5555/api/internal/erp-document-authorization');
    assert.equal(init?.method,'POST');
    assert.equal(init?.redirect,'error');
    const raw=String(init?.body ?? '');
    const proof={
      timestamp:String(new Headers(init?.headers).get('x-cisne-bridge-timestamp')),
      nonce:String(new Headers(init?.headers).get('x-cisne-bridge-nonce')),
      signature:String(new Headers(init?.headers).get('x-cisne-bridge-signature')),
    };
    assert.equal(verifyBridgeRequest(secret,raw,proof),true);
    const json=JSON.parse(raw) as Record<string,unknown>;
    assert.equal(json.purpose,'file');
    const result=answer(json);
    const body=JSON.stringify(result.body);
    return new Response(body,{status:result.status,headers:{
      'x-cisne-bridge-response-signature':options.forge?'v1='+'f'.repeat(64):
        signBridgeResponse(secret,body,result.status,proof),
    }});
  };
  const config={
    baseUrl:'http://127.0.0.1:5555',
    secret,instanceKey:'cisne-ci-isolated',fetchImpl,
    timeoutMs:1500,minioPublicOrigin:'https://nextcrm-minio-staging.up.railway.app',
    minioBucket:'nextcrm',
  };
  return {config,calls:()=>calls};
}
const successful=(request:Record<string,unknown>)=>({
  status:200,
  body:{
    authorized:true,id:request.documentId,accountId:request.accountId,
    tenantKey:request.tenantKey,version:1,sha256:'a'.repeat(64),
    expiresIn:60,fileUrl:signedUrl,
  },
});

test('accepts an HMAC-signed ticket matching the exact document, digest and public origin',async()=>{
  const f=makeConfig(successful);
  const result=await requestNextcrmFileTicket(f.config,input);
  assert.equal(result,signedUrl);
  assert.equal(f.calls(),1);
});
test('signed NextCRM denial does not become a file ticket',async()=>{
  const f=makeConfig(()=>({status:404,body:{authorized:false}}));
  assert.equal(await requestNextcrmFileTicket(f.config,input),null);
});
test('unsigned and altered replies fail closed',async()=>{
  const f=makeConfig(successful,{forge:true});
  await assert.rejects(()=>requestNextcrmFileTicket(f.config,input),
    (e:unknown)=>e instanceof NextcrmBridgeUnavailable);
});
test('a signed response with an external/private/wrong S3 URL never reaches a browser',async()=>{
  const urls=[
    'https://attacker.example.invalid/nextcrm/documents/a?X-Amz-Signature='+'a'.repeat(64),
    signedUrl.replace('https://','http://'),
    signedUrl.replace('/nextcrm/documents/','/other-bucket/documents/'),
    signedUrl.replace('X-Amz-Expires=60','X-Amz-Expires=3600'),
    signedUrl.replace('/documents/','/avatars/'),
    signedUrl.replace('X-Amz-Signature=','X-Fake-Signature='),
  ];
  for(const url of urls){
    const f=makeConfig(req=>({...successful(req),body:{...successful(req).body,fileUrl:url}}));
    await assert.rejects(()=>requestNextcrmFileTicket(f.config,input),
      (e:unknown)=>e instanceof NextcrmBridgeUnavailable);
  }
});
test('document version or SHA changed upstream means no file',async()=>{
  for(const changed of [{version:2},{sha256:'b'.repeat(64)}]){
    const f=makeConfig(req=>({...successful(req),body:{...successful(req).body,...changed}}));
    await assert.rejects(()=>requestNextcrmFileTicket(f.config,input),
      (e:unknown)=>e instanceof NextcrmBridgeUnavailable);
  }
});
test('a browser-provided or untrusted bridge host is impossible',async()=>{
  const f=makeConfig(successful);
  await assert.rejects(()=>requestNextcrmFileTicket({...f.config,baseUrl:'https://attacker.invalid'},input),
    (e:unknown)=>e instanceof NextcrmBridgeUnavailable);
  assert.equal(f.calls(),0);
});
