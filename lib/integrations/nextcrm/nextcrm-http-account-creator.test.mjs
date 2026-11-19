import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createNextcrmAccountForClient,
  NextcrmAccountCreateConflict,
  NextcrmAccountCreateUnavailable,
} from './nextcrm-http-account-creator.ts';
import {
  NEXTCRM_ACCOUNT_CREATE_PATH,
  signBridgeResponseForPath, verifyBridgeRequestForPath,
} from './bridge-protocol.ts';

const id='124d9241-6bba-4e52-9551-392a96a2474f';
const user='ae65cf22-968d-4c6d-af2c-67e548eabf6e';
const account='906cebab-594b-497d-8790-244e681ce7e1';
const secret='a'.repeat(64);
const conf={baseUrl:'http://127.0.0.1:33333',secret,instanceKey:'cisne_hml_2026',timeoutMs:3000};

function bridge(status, body, inspect=()=>{}, validSignature=true){
  return async (url,opts)=>{
    assert.equal(String(url),conf.baseUrl+NEXTCRM_ACCOUNT_CREATE_PATH);
    assert.equal(opts.method,'POST');
    const reqBody=String(opts.body);
    const proof={
      timestamp:opts.headers['x-cisne-bridge-timestamp'],
      nonce:opts.headers['x-cisne-bridge-nonce'],
      signature:opts.headers['x-cisne-bridge-signature'],
    };
    assert.equal(verifyBridgeRequestForPath(secret,reqBody,proof,NEXTCRM_ACCOUNT_CREATE_PATH),true);
    inspect(JSON.parse(reqBody));
    const data=JSON.stringify(body);
    const signature=signBridgeResponseForPath(secret,data,status,proof,NEXTCRM_ACCOUNT_CREATE_PATH);
    return new Response(data,{status,headers:{
      'X-Cisne-Bridge-Response-Signature':validSignature?signature:'v1='+'f'.repeat(64),
    }});
  };
}

test('signed creation returns authorized mapping and does not accept browser-specified owners',async()=>{
  const called=[];
  const result=await createNextcrmAccountForClient({...conf,fetchImpl:bridge(200,{
    authorized:true,accountId:account,erpClientId:id,tenantKey:conf.instanceKey,created:true,
  },x=>called.push(x))},user,id,'Cliente UAT',{billingCity:'Porto Velho'});
  assert.deepEqual(result,{accountId:account,created:true});
  assert.equal(called[0].subjectId,user);
  assert.equal(called[0].erpClientId,id);
  assert.equal(called[0].profile.billingCity,'Porto Velho');
  assert.equal(Object.hasOwn(called[0],'assigned_to'),false);
});

test('signed retry may return existing account, not another record',async()=>{
  const response={authorized:true,accountId:account,erpClientId:id,tenantKey:conf.instanceKey,created:false};
  const result=await createNextcrmAccountForClient({...conf,fetchImpl:bridge(200,response)},user,id,'Cliente UAT',{});
  assert.deepEqual(result,{accountId:account,created:false});
});

test('do not trust success from CRM without the response HMAC',async()=>{
  const response={authorized:true,accountId:account,erpClientId:id,tenantKey:conf.instanceKey,created:true};
  await assert.rejects(
    createNextcrmAccountForClient({...conf,fetchImpl:bridge(200,response,()=>{},false)},user,id,'Cliente UAT',{}),
    NextcrmAccountCreateUnavailable,
  );
});

test('conflict on an existing foreign CRM account is explicit',async()=>{
  await assert.rejects(
    createNextcrmAccountForClient({...conf,fetchImpl:bridge(409,{error:'Account mapping conflict'})},user,id,'Cliente UAT',{}),
    NextcrmAccountCreateConflict,
  );
});

test('invalid owner hints and oversized data are rejected before sending',async()=>{
  const never=async()=>{throw new Error('must not reach network');};
  await assert.rejects(
    createNextcrmAccountForClient({...conf,fetchImpl:never},user,id,'Cliente UAT',{assigned_to:'admin'}),
    NextcrmAccountCreateUnavailable,
  );
  await assert.rejects(
    createNextcrmAccountForClient({...conf,fetchImpl:never},user,id,'Cliente UAT',{description:'X'.repeat(5000)}),
    NextcrmAccountCreateUnavailable,
  );
  await assert.rejects(
    createNextcrmAccountForClient({...conf,fetchImpl:never},user,'forged-id','Cliente UAT',{}),
    NextcrmAccountCreateUnavailable,
  );
});
