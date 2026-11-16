import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { approvedStagingPublicOrigin } from '../../../lib/api/staging-public-origin.mjs';
import { issueStagingSession, stagingSessionCookieHeader, clearedStagingSessionCookie, validateStagingSession } from '../../../lib/api/staging-session.mjs';
export const dynamic='force-dynamic';
export const runtime='nodejs';
const headers={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'};
const input=z.object({passphrase:z.string().min(24).max(160)}).strict();
const runtime=()=>process.env.RAILWAY_ENVIRONMENT_NAME==='staging'||process.env.CISNE_STAGING_UAT==='true';
const origin=()=>approvedStagingPublicOrigin();
const configured=()=>runtime()&&origin()!==null&&/^[a-f0-9]{64}$/.test(process.env.CISNE_STAGING_LOGIN_HASH||'')&&(process.env.CISNE_STAGING_SESSION_SECRET||'').length>=32&&(process.env.CISNE_STAGING_ACTOR_ID||'').length>=8;
const json=(d:object,s=200,h:Record<string,string>={})=>Response.json(d,{status:s,headers:{...headers,...h}});
const allowed=(r:Request)=>r.headers.get('origin')===origin();
export async function GET(r:Request){if(!runtime())return json({error:'Not found'},404);return json({authenticated:configured()&&Boolean(validateStagingSession(r))});}
export async function POST(r:Request){if(!runtime())return json({error:'Not found'},404);if(!configured())return json({error:'Autenticação de homologação não configurada.'},503);if(!allowed(r))return json({error:'Origem não autorizada.'},403);const raw=await r.text();if(raw.length>1024)return json({error:'Credencial inválida.'},400);let parsed:unknown;try{parsed=JSON.parse(raw)}catch{return json({error:'Credencial inválida.'},400)}const p=input.safeParse(parsed);if(!p.success)return json({error:'Credencial inválida.'},400);const submitted=createHash('sha256').update(p.data.passphrase,'utf8').digest();const expected=Buffer.from(process.env.CISNE_STAGING_LOGIN_HASH!,'hex');if(submitted.length!==expected.length||!timingSafeEqual(submitted,expected))return json({error:'Credencial não autorizada.'},401);const token=issueStagingSession(process.env.CISNE_STAGING_ACTOR_ID!,process.env.CISNE_STAGING_SESSION_SECRET!);return json({authenticated:true},200,{'Set-Cookie':stagingSessionCookieHeader(token)});}
export async function DELETE(r:Request){if(!runtime())return json({error:'Not found'},404);if(!allowed(r))return json({error:'Origem não autorizada.'},403);return json({authenticated:false},200,{'Set-Cookie':clearedStagingSessionCookie()});}
