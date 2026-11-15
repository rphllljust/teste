import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  signBridgeRequest, signBridgeResponse, verifyBridgeRequest,
  verifyBridgeResponse, NEXTCRM_BRIDGE_PATH,
} from './bridge-protocol.ts';
import {
  createNextcrmHttpDocumentVerifier, NextcrmBridgeUnavailable,
} from './nextcrm-http-document-verifier.ts';

process.env.NODE_ENV = 'test'; // Isolated CI-only loopback transport\nconst secret = randomBytes(32).toString('hex');
const id = randomUUID(), subjectId = randomUUID(), accountId = randomUUID(), erpClientId = randomUUID();
const instanceKey = 'cisne-hml-1';

test('bridge HMAC rejects replay outside window, altered body and invalid proof', () => {
  const body = JSON.stringify({ documentId: id, accountId });
  const p = signBridgeRequest(secret, body, {timestamp: String(Date.now()),nonce:randomBytes(16).toString('hex')});
  assert.equal(verifyBridgeRequest(secret, body, p),true);
  assert.equal(verifyBridgeRequest(secret, body+'x', p),false);
  assert.equal(verifyBridgeRequest(secret, body, {...p,signature:'v1='+('0'.repeat(64))}),false);
  assert.equal(verifyBridgeRequest(secret, body, p, Date.now()+90_000),false);
  assert.equal(verifyBridgeRequest(secret, body, {...p,nonce:'x'}),false);
  const answer = JSON.stringify({authorized:true});
  const signed=signBridgeResponse(secret,answer,200,p);
  assert.equal(verifyBridgeResponse(secret,answer,200,p,signed),true);
  assert.equal(verifyBridgeResponse(secret,answer+' ',200,p,signed),false);
  assert.equal(verifyBridgeResponse(secret,answer,404,p,signed),false);
  assert.equal(verifyBridgeResponse(secret,answer,200,{...p,nonce:'f'.repeat(32)},signed),false);
});

test('bridge rejects public/malicious endpoints and invalid keys before any request', () => {
  for (const baseUrl of [
    'http://example.com', 'https://attacker.example', 'http://localhost:3000',
    'http://nextcrm-web.railway.internal:3000@attacker.example',
    'http://nextcrm-web.railway.internal:3000/pwn',
    'http://nextcrm-web.railway.internal:3000?x=1',
  ]) {
    assert.throws(() => createNextcrmHttpDocumentVerifier({baseUrl, secret,instanceKey}));
  }
  assert.throws(() => createNextcrmHttpDocumentVerifier({
    baseUrl:'http://nextcrm-web.railway.internal:3000', secret:'weak',instanceKey,
  }));
});

test('signed, real loopback HTTP roundtrip accepts exact scope and refuses forged responses', async () => {
  let mode='permit';
  let requests=0;
  const server=createServer(async(req,res)=>{
    requests++;
    const chunks=[];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body=Buffer.concat(chunks).toString('utf8');
    const proof={
      timestamp:String(req.headers['x-cisne-bridge-timestamp']??''),
      nonce:String(req.headers['x-cisne-bridge-nonce']??''),
      signature:String(req.headers['x-cisne-bridge-signature']??''),
    };
    if(req.method!=='POST'||req.url!==NEXTCRM_BRIDGE_PATH||
       !verifyBridgeRequest(secret,body,proof)) {
      res.writeHead(401);res.end('Unauthorized');return;
    }
    const input=JSON.parse(body);
    const permitted=mode==='permit'&&
      input.documentId===id&&input.accountId===accountId&&
      input.subjectId===subjectId&&input.erpClientId===erpClientId&&
      input.tenantKey===instanceKey;
    const status=permitted?200:404;
    const output=permitted?{
      authorized:true,id,accountId,tenantKey:instanceKey,version:2,sha256:'a'.repeat(64),
    }:{authorized:false};
    const raw=JSON.stringify(output);
    res.writeHead(status,{
      'content-type':'application/json',
      'x-cisne-bridge-response-signature': mode==='forged'?'v1='+('0'.repeat(64)):
        signBridgeResponse(secret,raw,status,proof),
    });
    res.end(raw);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();
  if(!address||typeof address==='string')throw new Error('No local test port');
  try {
    const verifier=createNextcrmHttpDocumentVerifier({
      baseUrl:'http://127.0.0.1:'+address.port,secret,instanceKey,timeoutMs:1000,
    });
    const allow=await verifier.verifyDocumentForLink(id,subjectId,accountId,erpClientId,instanceKey);
    assert.deepEqual(allow,{id,accountId,tenantKey:instanceKey,version:2,sha256:'a'.repeat(64),canLink:true});
    assert.equal(await verifier.verifyDocumentForLink(id,randomUUID(),accountId,erpClientId,instanceKey),null);
    const count=requests;
    assert.equal(await verifier.verifyDocumentForLink(id,subjectId,accountId,erpClientId,'foreign-tenant'),null);
    assert.equal(requests,count,'foreign instance request must never reach network');
    mode='forged';
    await assert.rejects(()=>verifier.verifyDocumentForLink(id,subjectId,accountId,erpClientId,instanceKey),
      e=>e instanceof NextcrmBridgeUnavailable);
  } finally {
    await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
  }
});
