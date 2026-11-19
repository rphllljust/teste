import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { signBridgeResponseForPath, verifyBridgeRequestForPath } from '../../lib/integrations/nextcrm/bridge-protocol';
import { completeNextcrmUpload, requestNextcrmUploadTicket } from '../../lib/integrations/nextcrm/nextcrm-upload-ticket';
import { NextcrmBridgeUnavailable } from '../../lib/integrations/nextcrm/nextcrm-http-document-verifier';

if (process.env.NODE_ENV !== 'test') throw Error('Only the ephemeral CI fixture may run this upload-ticket test');

const secret=randomBytes(32).toString('hex');
const input={subjectId:randomUUID(),accountId:randomUUID(),erpClientId:randomUUID(),tenantKey:'cisne-ci-isolated',name:'laudo.txt',contentType:'text/plain',size:12,sha256:'a'.repeat(64),requestId:randomUUID()};
const uploadUrl='http://127.0.0.1:19000/nextcrm/documents/upload?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=600&X-Amz-Signature='+'a'.repeat(64);

function config(answer:(body:Record<string,unknown>)=>Record<string,unknown>, forge=false){
 const fetchImpl:typeof fetch=async(target,init)=>{
  assert.equal(String(target),'http://127.0.0.1:5555/api/internal/erp-document-upload');
  const headers=new Headers(init?.headers);const raw=String(init?.body??'');
  const proof={timestamp:String(headers.get('x-cisne-bridge-timestamp')),nonce:String(headers.get('x-cisne-bridge-nonce')),signature:String(headers.get('x-cisne-bridge-signature'))};
  assert.equal(verifyBridgeRequestForPath(secret,raw,proof,'/api/internal/erp-document-upload'),true);
  const body=answer(JSON.parse(raw) as Record<string,unknown>);const responseBody=JSON.stringify(body);
  return new Response(responseBody,{status:200,headers:{'x-cisne-bridge-response-signature':forge?'v1='+'f'.repeat(64):signBridgeResponseForPath(secret,responseBody,200,proof,'/api/internal/erp-document-upload')}});
 };
 return {baseUrl:'http://127.0.0.1:5555',secret,instanceKey:'cisne-ci-isolated',timeoutMs:1500,fetchImpl,minioPublicOrigin:'http://127.0.0.1:19000'};
}

test('accepts a signed presigned upload ticket for the isolated MinIO origin',async()=>{
 const result=await requestNextcrmUploadTicket(config(()=>({authorized:true,documentId:input.requestId,version:1,sha256:input.sha256,expiresIn:600,uploadUrl}),false),input);
 assert.equal(result.uploadUrl,uploadUrl);
});

test('rejects forged replies and external upload origins',async()=>{
 await assert.rejects(()=>requestNextcrmUploadTicket(config(()=>({authorized:true,documentId:input.requestId,version:1,sha256:input.sha256,expiresIn:600,uploadUrl}),true),input),(e:unknown)=>e instanceof NextcrmBridgeUnavailable);
 const external=uploadUrl.replace('127.0.0.1:19000','attacker.invalid');
 await assert.rejects(()=>requestNextcrmUploadTicket(config(()=>({authorized:true,documentId:input.requestId,version:1,sha256:input.sha256,expiresIn:600,uploadUrl:external}),false),input),(e:unknown)=>e instanceof NextcrmBridgeUnavailable);
});

test('accepts only the signed completion for the requested document',async()=>{
 const result=await completeNextcrmUpload(config(body=>({authorized:true,documentId:body.documentId,version:1,sha256:body.sha256}),false),{...input,documentId:input.requestId});
 assert.equal(result.documentId,input.requestId);
});
