import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const CISNE_PRODUCTION_COOKIE='__Host-cisne_production';
export const CISNE_PRODUCTION_SESSION_MS=8*60*60*1000;
const mac=(secret,payload)=>createHmac('sha256',secret).update(payload).digest();
export function issueProductionSession(actorId,secret,now=Date.now()){
 if(typeof actorId!=='string'||actorId.length<8||typeof secret!=='string'||secret.length<32)
  throw Error('Production identity is not securely configured');
 const payload=Buffer.from(JSON.stringify({
  v:1,sub:actorId,iat:now,exp:now+CISNE_PRODUCTION_SESSION_MS,
  nonce:randomBytes(16).toString('hex'),
 })).toString('base64url');
 return payload+'.'+mac(secret,payload).toString('base64url');
}
export function validateProductionSession(request,env=process.env,now=Date.now()){
 if(env.RAILWAY_ENVIRONMENT_NAME!=='production')return null;
 const secret=env.CISNE_PRODUCTION_SESSION_SECRET;
 const actor=env.CISNE_PRODUCTION_ACTOR_ID;
 if(typeof secret!=='string'||secret.length<32||typeof actor!=='string'||actor.length<8)return null;
 const value=(request.headers.get('cookie')||'').split(';').map(v=>v.trim())
  .find(v=>v.startsWith(CISNE_PRODUCTION_COOKIE+'='))
  ?.slice(CISNE_PRODUCTION_COOKIE.length+1);
 if(!value||value.length>1024)return null;
 const parts=value.split('.');
 if(parts.length!==2||parts.some(x=>!x||!/^[A-Za-z0-9_-]+$/.test(x)))return null;
 try {
  const supplied=Buffer.from(parts[1],'base64url');
  const expected=mac(secret,parts[0]);
  if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return null;
  const claims=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
  if(claims?.v!==1||claims.sub!==actor||!Number.isSafeInteger(claims.iat)||
   !Number.isSafeInteger(claims.exp)||!/^[0-9a-f]{32}$/.test(claims.nonce)||
   claims.iat>now+60_000||claims.exp<=now||
   claims.exp-claims.iat!==CISNE_PRODUCTION_SESSION_MS)return null;
  return actor;
 }catch{return null;}
}
export function productionSessionCookieHeader(token){
 return CISNE_PRODUCTION_COOKIE+'='+token+'; Path=/; Max-Age='+
  Math.floor(CISNE_PRODUCTION_SESSION_MS/1000)+'; Secure; HttpOnly; SameSite=Strict';
}
export function clearedProductionSessionCookie(){
 return CISNE_PRODUCTION_COOKIE+'=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict';
}
