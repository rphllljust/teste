import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
 issueProductionSession,validateProductionSession,
 productionSessionCookieHeader,clearedProductionSessionCookie,
} from '../../../../lib/api/production-session.mjs';

export const dynamic='force-dynamic';
const canonical='https://teste-production-c4f9f56e.up.railway.app';
const headers={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'};
const input=z.object({passphrase:z.string().min(32).max(160)}).strict();
function configured(){
 return process.env.RAILWAY_ENVIRONMENT_NAME==='production'&&
  process.env.CISNE_PRODUCTION_PUBLIC_ORIGIN===canonical&&
  /^[a-f0-9]{64}$/.test(process.env.CISNE_PRODUCTION_LOGIN_HASH??'')&&
  (process.env.CISNE_PRODUCTION_SESSION_SECRET?.length??0)>=32&&
  (process.env.CISNE_PRODUCTION_ACTOR_ID?.length??0)>=8;
}
function json(data:object,status=200,additional:Record<string,string>={}){
 return Response.json(data,{status,headers:{...headers,...additional}});
}
export async function GET(request:Request){
 if(process.env.RAILWAY_ENVIRONMENT_NAME!=='production')return json({error:'Not found'},404);
 return json({authenticated:configured()&&Boolean(validateProductionSession(request))});
}
export async function POST(request:Request){
 if(process.env.RAILWAY_ENVIRONMENT_NAME!=='production')return json({error:'Not found'},404);
 if(!configured())return json({error:'O acesso de produção não está configurado.'},503);
 if(request.headers.get('origin')!==canonical)return json({error:'Origem não autorizada.'},403);
 const raw=await request.text();
 if(raw.length>1024)return json({error:'Credencial inválida.'},400);
 let parsed:unknown;
 try{parsed=JSON.parse(raw);}catch{return json({error:'Credencial inválida.'},400);}
 const check=input.safeParse(parsed);
 if(!check.success)return json({error:'Credencial inválida.'},400);
 const digest=createHash('sha256').update(check.data.passphrase,'utf8').digest();
 const expected=Buffer.from(process.env.CISNE_PRODUCTION_LOGIN_HASH!,'hex');
 if(digest.length!==expected.length||!timingSafeEqual(digest,expected))
  return json({error:'Credencial não autorizada.'},401);
 const token=issueProductionSession(process.env.CISNE_PRODUCTION_ACTOR_ID!,
  process.env.CISNE_PRODUCTION_SESSION_SECRET!);
 return json({authenticated:true},200,{'Set-Cookie':productionSessionCookieHeader(token)});
}
export async function DELETE(request:Request){
 if(process.env.RAILWAY_ENVIRONMENT_NAME!=='production')return json({error:'Not found'},404);
 if(request.headers.get('origin')!==canonical)return json({error:'Origem não autorizada.'},403);
 return json({authenticated:false},200,{'Set-Cookie':clearedProductionSessionCookie()});
}
