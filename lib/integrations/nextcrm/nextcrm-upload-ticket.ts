import { randomUUID } from 'node:crypto';
import {
  NEXTCRM_UPLOAD_PATH, signBridgeRequestForPath, verifyBridgeResponseForPath,
} from './bridge-protocol.ts';
import { NextcrmBridgeUnavailable, type NextcrmBridgeConfig } from './nextcrm-http-document-verifier.ts';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[0-9a-f]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const MIME=/^[\w.+-]+\/[\w.+-]+$/;
const NAME=/^[^\\/\r\n]{1,160}$/;
const MAX=8*1024*1024;

export type NextcrmUploadInput={
 subjectId:string; accountId:string; erpClientId:string; tenantKey:string;
 name:string; contentType:string; size:number; sha256:string; requestId?:string;
};
export type NextcrmUploadTicket={documentId:string;uploadUrl:string;version:number;expiresIn:number;sha256:string};

function validateInput(input:NextcrmUploadInput){
 if(![input.subjectId,input.accountId,input.erpClientId].every(v=>UUID.test(v)) ||
    !/^[A-Za-z0-9_-]{3,128}$/.test(input.tenantKey) || !NAME.test(input.name) ||
    !MIME.test(input.contentType) || !Number.isSafeInteger(input.size) || input.size<1 || input.size>MAX ||
    !HASH.test(input.sha256)) throw new NextcrmBridgeUnavailable();
}
function configOk(config:NextcrmBridgeConfig){
 const url=new URL(config.baseUrl);
 const loopbackTest=process.env.NODE_ENV==='test'&&url.protocol==='http:'&&url.hostname==='127.0.0.1'&&Number(url.port)>0;
 return ((url.protocol==='http:' && url.hostname==='nextcrm-web.railway.internal' && url.port==='3000')||loopbackTest) &&
   /^[A-Za-z0-9_-]{3,128}$/.test(config.instanceKey) && /^[a-f0-9]{64,128}$/.test(config.secret) &&
   Number.isSafeInteger(config.timeoutMs??3000) && (config.timeoutMs??3000)>=100 && (config.timeoutMs??3000)<=5000;
}
function parseResponse(config:NextcrmBridgeConfig,raw:string,status:number,proof:{timestamp:string;nonce:string},signature:string):Record<string,unknown>{
 if(raw.length>4096 || !verifyBridgeResponseForPath(config.secret,raw,status,proof,signature,NEXTCRM_UPLOAD_PATH)) throw new NextcrmBridgeUnavailable();
 const value:unknown=JSON.parse(raw);
 if(!value||typeof value!=='object')throw new NextcrmBridgeUnavailable();
 return value as Record<string,unknown>;
}
async function call(config:NextcrmBridgeConfig, input:Record<string,unknown>):Promise<Record<string,unknown>>{
 if(!configOk(config))throw new NextcrmBridgeUnavailable();
 const body=JSON.stringify({...input,requestId:input.requestId??randomUUID()});
 const proof=signBridgeRequestForPath(config.secret,body,NEXTCRM_UPLOAD_PATH);
 let response:Response;
 try{response=await (config.fetchImpl??fetch)(new URL(NEXTCRM_UPLOAD_PATH,config.baseUrl),{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(config.timeoutMs??3000),headers:{'content-type':'application/json','x-cisne-bridge-timestamp':proof.timestamp,'x-cisne-bridge-nonce':proof.nonce,'x-cisne-bridge-signature':proof.signature},body});}
 catch{throw new NextcrmBridgeUnavailable();}
 const raw=await response.text();
 if(response.status!==200&&response.status!==404)throw new NextcrmBridgeUnavailable();
 const result=parseResponse(config,raw,response.status,proof,response.headers.get('x-cisne-bridge-response-signature')??'');
 if(response.status===404||result.authorized!==true)throw new NextcrmBridgeUnavailable();
 return result;
}
export async function requestNextcrmUploadTicket(config:NextcrmBridgeConfig,input:NextcrmUploadInput):Promise<NextcrmUploadTicket>{
 validateInput(input);
 const result=await call(config,{action:'prepare',...input});
 const uploadUrl=typeof result.uploadUrl==='string'?new URL(result.uploadUrl):null;
 const expectedOrigin=config.minioPublicOrigin?new URL(config.minioPublicOrigin):null;
 const localTest=process.env.NODE_ENV==='test'&&uploadUrl?.protocol==='http:'&&
   (uploadUrl.hostname==='127.0.0.1'||uploadUrl.hostname==='localhost');
 const expectedOriginMatch=expectedOrigin&&uploadUrl&&uploadUrl.origin===expectedOrigin.origin;
 if(!uploadUrl||(!expectedOriginMatch&&!localTest)||
    uploadUrl.searchParams.get('X-Amz-Algorithm')!=='AWS4-HMAC-SHA256' || uploadUrl.searchParams.get('X-Amz-Expires')!=='600' ||
    typeof result.documentId!=='string'||!UUID.test(result.documentId)||result.version!==1||result.expiresIn!==600||result.sha256!==input.sha256) throw new NextcrmBridgeUnavailable();
 return {documentId:result.documentId,uploadUrl:uploadUrl.toString(),version:1,expiresIn:600,sha256:input.sha256};
}
export async function completeNextcrmUpload(config:NextcrmBridgeConfig,input:{documentId:string;subjectId:string;accountId:string;erpClientId:string;tenantKey:string;name:string;contentType:string;size:number;sha256:string}):Promise<{documentId:string;version:number;sha256:string}>{
 if(!UUID.test(input.documentId)||!UUID.test(input.subjectId)||!UUID.test(input.accountId)||!UUID.test(input.erpClientId)||!Number.isSafeInteger(input.size)||input.size<1||input.size>MAX||!HASH.test(input.sha256)) throw new NextcrmBridgeUnavailable();
 if(!NAME.test(input.name)||!MIME.test(input.contentType)) throw new NextcrmBridgeUnavailable();
 const result=await call(config,{action:'complete',...input});
 if(result.documentId!==input.documentId||result.version!==1||result.sha256!==input.sha256)throw new NextcrmBridgeUnavailable();
 return {documentId:input.documentId,version:1,sha256:input.sha256};
}
