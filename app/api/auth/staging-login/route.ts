import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { approvedStagingPublicOrigin } from '../../../../lib/api/staging-public-origin.mjs';
import {
  issueStagingSession, stagingSessionCookieHeader,
  clearedStagingSessionCookie, validateStagingSession,
} from '../../../../lib/api/staging-session.mjs';

export const dynamic='force-dynamic';
const jsonHeaders={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'};
const loginInput=z.object({passphrase:z.string().min(24).max(160)}).strict();
function publicOrigin(){return approvedStagingPublicOrigin();}
function stagingRuntime(){
  // Railway's reserved environment variable is not reliable in every
  // isolated UAT service. The explicit flag is scoped to this UAT service.
  return process.env.RAILWAY_ENVIRONMENT_NAME==='staging' ||
    process.env.CISNE_STAGING_UAT==='true';
}
function configured(){
  const hash=process.env.CISNE_STAGING_LOGIN_HASH;
  return stagingRuntime()&&
    publicOrigin()!==null&&
    typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash)&&
    typeof process.env.CISNE_STAGING_SESSION_SECRET==='string'&&
    process.env.CISNE_STAGING_SESSION_SECRET.length>=32&&
    typeof process.env.CISNE_STAGING_ACTOR_ID==='string'&&
    process.env.CISNE_STAGING_ACTOR_ID.length>=8;
}
function allowedOrigin(request:Request){
  return request.headers.get('origin')===publicOrigin();
}
function json(data:object,status=200,extra:Record<string,string>={}){
  return Response.json(data,{status,headers:{...jsonHeaders,...extra}});
}
export async function GET(request:Request){
  if(!stagingRuntime())
    return json({error:'Not found'},404);
  return json({authenticated:configured()&&Boolean(validateStagingSession(request))});
}
export async function POST(request:Request){
  if(process.env.RAILWAY_ENVIRONMENT_NAME!=='staging')
    return json({error:'Not found'},404);
  if(!configured())return json({error:'Autenticação de homologação não configurada.'},503);
  if(!allowedOrigin(request))return json({error:'Origem não autorizada.'},403);
  // Extremely high-entropy passphrase is mandatory; never log it, its hash,
  // session values, caller identity or the contents of invalid requests.
  const raw=await request.text();
  if(raw.length>1024)return json({error:'Credencial inválida.'},400);
  let parsed:unknown;
  try{parsed=JSON.parse(raw);}catch{return json({error:'Credencial inválida.'},400);}
  const input=loginInput.safeParse(parsed);
  if(!input.success)return json({error:'Credencial inválida.'},400);
  const submitted=createHash('sha256').update(input.data.passphrase,'utf8').digest();
  const expected=Buffer.from(process.env.CISNE_STAGING_LOGIN_HASH!,'hex');
  if(submitted.length!==expected.length||!timingSafeEqual(submitted,expected))
    return json({error:'Credencial não autorizada.'},401);
  const token=issueStagingSession(process.env.CISNE_STAGING_ACTOR_ID!,
    process.env.CISNE_STAGING_SESSION_SECRET!);
  return json({authenticated:true},200,{'Set-Cookie':stagingSessionCookieHeader(token)});
}
export async function DELETE(request:Request){
  if(process.env.RAILWAY_ENVIRONMENT_NAME!=='staging')
    return json({error:'Not found'},404);
  if(!allowedOrigin(request))return json({error:'Origem não autorizada.'},403);
  return json({authenticated:false},200,{'Set-Cookie':clearedStagingSessionCookie()});
}
