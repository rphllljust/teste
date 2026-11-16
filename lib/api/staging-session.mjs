import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const CISNE_STAGING_COOKIE = '__Host-cisne_staging';
export const CISNE_SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

function mac(secret, data) {
  return createHmac('sha256', secret).update(data).digest();
}
function safeEquals(a,b) {
  return a.length === b.length && timingSafeEqual(a,b);
}
export function issueStagingSession(actorId, secret, now=Date.now()) {
  if(typeof actorId!=='string'||!actorId||typeof secret!=='string'||secret.length<32)
    throw new Error('Invalid secure staging session configuration');
  const payload=Buffer.from(JSON.stringify({
    v:1,sub:actorId,iat:now,exp:now+CISNE_SESSION_DURATION_MS,
    nonce:randomBytes(16).toString('hex'),
  })).toString('base64url');
  return payload+'.'+mac(secret,payload).toString('base64url');
}
export function validateStagingSession(request, env=process.env, now=Date.now()) {
  if(env.RAILWAY_ENVIRONMENT_NAME!=='staging')return null;
  const secret=env.CISNE_STAGING_SESSION_SECRET;
  const expectedActor=env.CISNE_STAGING_ACTOR_ID;
  if(typeof secret!=='string'||secret.length<32||typeof expectedActor!=='string'||!expectedActor)return null;
  const cookie=(request.headers.get('cookie')||'').split(';').map(x=>x.trim())
    .find(x=>x.startsWith(CISNE_STAGING_COOKIE+'='));
  const value=cookie?.slice(CISNE_STAGING_COOKIE.length+1);
  if(!value||value.length>1024||!value.includes('.'))return null;
  const parts=value.split('.');
  if(parts.length!==2||!(/^[A-Za-z0-9_-]+$/).test(parts[0])||!(/^[A-Za-z0-9_-]+$/).test(parts[1]))return null;
  try {
    const supplied=Buffer.from(parts[1],'base64url');
    if(!safeEquals(mac(secret,parts[0]),supplied))return null;
    const claims=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
    if(claims?.v!==1||claims.sub!==expectedActor||!Number.isSafeInteger(claims.iat)||
       !Number.isSafeInteger(claims.exp)||!(/^[a-f0-9]{32}$/).test(claims.nonce))return null;
    if(claims.iat>now+60000||claims.exp<=now||claims.exp-claims.iat!==CISNE_SESSION_DURATION_MS)return null;
    return claims.sub;
  } catch {return null;}
}

export function stagingSessionCookieHeader(token) {
  return CISNE_STAGING_COOKIE+'='+token+
    '; Path=/; Max-Age='+Math.floor(CISNE_SESSION_DURATION_MS/1000)+
    '; Secure; HttpOnly; SameSite=Lax';
}
export function clearedStagingSessionCookie() {
  return CISNE_STAGING_COOKIE+'=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax';
}
