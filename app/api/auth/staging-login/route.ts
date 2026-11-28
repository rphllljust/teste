import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {database} from '../../../../db/raw';
import {verifyPersonalLogin} from '../../../../lib/api/personal-login.mjs';
import {
  issueStagingSession, stagingSessionCookieHeader,
  issuePersonalStagingSession,personalStagingSessionCookieHeader,
  clearedStagingSessionCookie, validateStagingSession,
} from '../../../../lib/api/staging-session.mjs';

export const dynamic='force-dynamic';
const jsonHeaders={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'};
const loginInput=z.object({passphrase:z.string().min(24).max(160)}).strict();
const personalInput=z.object({login:z.string().trim().min(3).max(80),passphrase:z.string().min(32).max(160)}).strict();
const personalMode=()=>process.env.CISNE_STAGING_AUTH_MODE==='individual';
function publicOrigin(){return process.env.CISNE_STAGING_PUBLIC_ORIGIN;}
function configured(){
  const hash=process.env.CISNE_STAGING_LOGIN_HASH;
  return process.env.RAILWAY_ENVIRONMENT_NAME==='staging'&&
    typeof publicOrigin()==='string'&&
    /^https:\/\/cisne-web-staging-staging[.]up[.]railway[.]app$/.test(publicOrigin()!)&&
    (personalMode()||typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash))&&
    typeof process.env.CISNE_STAGING_SESSION_SECRET==='string'&&
    process.env.CISNE_STAGING_SESSION_SECRET.length>=32&&
    (personalMode()||typeof process.env.CISNE_STAGING_ACTOR_ID==='string'&&
    process.env.CISNE_STAGING_ACTOR_ID.length>=8);
}
function allowedOrigin(request:Request){
  return request.headers.get('origin')===publicOrigin();
}
function json(data:object,status=200,extra:Record<string,string>={}){
  return Response.json(data,{status,headers:{...jsonHeaders,...extra}});
}
export async function GET(request:Request){
  if(process.env.RAILWAY_ENVIRONMENT_NAME!=='staging')
    return json({error:'Not found'},404);
  return json({authenticated:configured()&&Boolean(validateStagingSession(request)),authMode:personalMode()?'individual':'shared'});
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
  if(personalMode()){
    const check=personalInput.safeParse(parsed);
    if(!check.success)return json({error:'Credencial inválida.'},400);
    try{
      const result=await database().transaction(q=>verifyPersonalLogin(q,check.data.login,check.data.passphrase));
      if(!result.ok||!result.actorId)return json({error:'Credencial não autorizada.'},401);
      const token=issuePersonalStagingSession(result.actorId,process.env.CISNE_STAGING_SESSION_SECRET!);
      return json({authenticated:true},200,{'Set-Cookie':personalStagingSessionCookieHeader(token)});
    }catch{
      return json({error:'Autenticação individual indisponível.'},503);
    }
  }
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
