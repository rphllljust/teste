import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { prismadb } from '@/lib/prisma';
import { minioClient, MINIO_BUCKET, MINIO_PUBLIC_URL, presignPut } from '@/lib/minio';
import { accountReadScopeWhere, mapLegacyRole } from '@/lib/authz';
import {
  NEXTCRM_BRIDGE_MAX_BODY_BYTES, NEXTCRM_UPLOAD_PATH,
  signBridgeResponseForPath, verifyBridgeRequestForPath,
} from '@/lib/erp-bridge/bridge-protocol';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const MAX=8*1024*1024;
const uuid=z.string().uuid();
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('prepare'),subjectId:uuid,accountId:uuid,erpClientId:uuid,tenantKey:z.string().regex(/^[A-Za-z0-9_-]{3,128}$/),name:z.string().min(1).max(160).regex(/^[^\\/\r\n]+$/),contentType:z.string().regex(/^[\w.+-]+\/[\w.+-]+$/),size:z.number().int().positive().max(MAX),sha256:hash,requestId:uuid}).strict(),
 z.object({action:z.literal('complete'),documentId:uuid,subjectId:uuid,accountId:uuid,erpClientId:uuid,tenantKey:z.string().regex(/^[A-Za-z0-9_-]{3,128}$/),name:z.string().min(1).max(160).regex(/^[^\\/\r\n]+$/),contentType:z.string().regex(/^[\w.+-]+\/[\w.+-]+$/),size:z.number().int().positive().max(MAX),sha256:hash,requestId:uuid}).strict(),
]);

async function readBody(req:NextRequest){
 const length=req.headers.get('content-length');
 if(length&&(!/^\d{1,5}$/.test(length)||Number(length)>NEXTCRM_BRIDGE_MAX_BODY_BYTES)||!req.body)return null;
 const reader=req.body.getReader();const chunks:Uint8Array[]=[];let total=0;
 try{while(true){const item=await reader.read();if(item.done)break;total+=item.value.byteLength;if(total>NEXTCRM_BRIDGE_MAX_BODY_BYTES){await reader.cancel().catch(()=>{});return null;}chunks.push(item.value);}const all=new Uint8Array(total);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.byteLength;}return new TextDecoder('utf-8',{fatal:true}).decode(all);}catch{return null;}finally{reader.releaseLock();}
}
export async function POST(req:NextRequest){
 const secret=process.env.CISNE_NEXTCRM_BRIDGE_SECRET??'';const instanceKey=process.env.CISNE_NEXTCRM_INSTANCE_KEY??'';
 if(!/^[a-f0-9]{64,128}$/.test(secret)||!/^[A-Za-z0-9_-]{3,128}$/.test(instanceKey))return Response.json({error:'Unavailable'},{status:503});
 const reply=(status:number,value:Record<string,unknown>,proof:{timestamp:string;nonce:string})=>{const body=JSON.stringify(value);return new Response(body,{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Cisne-Bridge-Response-Signature':signBridgeResponseForPath(secret,body,status,proof,NEXTCRM_UPLOAD_PATH)}})};
 const proof={timestamp:req.headers.get('x-cisne-bridge-timestamp')??'',nonce:req.headers.get('x-cisne-bridge-nonce')??'',signature:req.headers.get('x-cisne-bridge-signature')??''};
 const raw=await readBody(req);
 if(req.nextUrl.pathname!==NEXTCRM_UPLOAD_PATH||req.nextUrl.search||req.method!=='POST'||req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json'||!raw||!verifyBridgeRequestForPath(secret,raw,proof,NEXTCRM_UPLOAD_PATH))return Response.json({error:'Unauthorized'},{status:401});
 let parsed;try{parsed=input.safeParse(JSON.parse(raw));}catch{parsed={success:false as const};}
 if(!parsed.success||parsed.data.tenantKey!==instanceKey)return reply(404,{authorized:false},proof);
 const value=parsed.data;
 try{
  const user=await prismadb.users.findUnique({where:{id:value.subjectId},select:{id:true,role:true,userStatus:true,banned:true}});
  if(!user||user.userStatus!=='ACTIVE'||user.banned)return reply(404,{authorized:false},proof);
  const actor={id:user.id,role:mapLegacyRole(user.role)};
  const account=await prismadb.crm_Accounts.findFirst({where:{id:value.accountId,external_ref:value.erpClientId,...accountReadScopeWhere(actor)},select:{id:true}});
  if(!account)return reply(404,{authorized:false},proof);
  const key=value.action==='prepare'?`documents/${value.requestId}`: `documents/${value.documentId}`;
  if(value.action==='prepare'){
   const documentId=key.slice('documents/'.length);
   const uploadUrl=await presignPut(key,value.contentType,600);
   return reply(200,{authorized:true,documentId,version:1,sha256:value.sha256,expiresIn:600,uploadUrl},proof);
  }
  const existing=await prismadb.documents.findFirst({where:{id:value.documentId,accounts:{some:{account_id:value.accountId}}},select:{id:true,version:true,content_hash:true,size:true}});
  if(existing){if(existing.content_hash===value.sha256&&existing.size===value.size)return reply(200,{authorized:true,documentId:existing.id,version:existing.version,sha256:value.sha256},proof);return reply(404,{authorized:false},proof);}
  const head=await minioClient.send(new HeadObjectCommand({Bucket:MINIO_BUCKET,Key:key}));
  if(head.ContentLength!==value.size||head.ContentType!==value.contentType)return reply(404,{authorized:false},proof);
  const object=await minioClient.send(new GetObjectCommand({Bucket:MINIO_BUCKET,Key:key}));
  const bytes=Buffer.from(await object.Body!.transformToByteArray());
  if(bytes.length!==value.size||createHash('sha256').update(bytes).digest('hex')!==value.sha256)return reply(404,{authorized:false},proof);
  const document=await prismadb.documents.create({data:{id:value.documentId,v:0,document_name:value.name,description:'CISNE Field OS attachment',created_by_user:value.subjectId,createdBy:value.subjectId,assigned_user:value.subjectId,document_file_mimeType:value.contentType,document_file_url:`${MINIO_PUBLIC_URL}/${MINIO_BUCKET}/${key}`,key,size:value.size,content_hash:value.sha256,version:1,processing_status:'PENDING',accounts:{create:{account_id:value.accountId}}},select:{id:true,version:true,content_hash:true}});
  return reply(200,{authorized:true,documentId:document.id,version:document.version,sha256:document.content_hash},proof);
 }catch{return reply(503,{error:'Unavailable'},proof);}
}
