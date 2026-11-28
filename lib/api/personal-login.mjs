import {createHash,randomBytes,scrypt as scryptCb,timingSafeEqual,randomUUID} from 'node:crypto';
import {promisify} from 'node:util';

const scrypt=promisify(scryptCb);
const policy={N:32768,r:8,p:1,maxmem:64*1024*1024};
const fakeSalt=Buffer.from('735adca6bcd14f8190b245aa99548cb3bb59b218d16ea60f3048f600e3da618f','hex');
const fakeDigest=Buffer.alloc(64,0xa5);
export const LOGIN_HANDLE_PATTERN=/^[a-z0-9][a-z0-9._-]{2,79}$/;
export function normalizeHandle(value){
 if(typeof value!=='string')return null;
 const h=value.trim().toLowerCase();
 return LOGIN_HANDLE_PATTERN.test(h)?h:null;
}
export function eligiblePassword(value){return typeof value==='string'&&value.length>=32&&value.length<=160;}
export async function hashPersonalPassword(passphrase,salt=randomBytes(32)){
 if(!eligiblePassword(passphrase)||!Buffer.isBuffer(salt)||salt.length!==32)
  throw new Error('PERSONAL_LOGIN_POLICY_NOT_MET');
 return {salt,hash:await scrypt(passphrase,salt,64,policy)};
}
function equalHash(a,b){return a.length===b.length&&timingSafeEqual(a,b);}
function rejected(){return {ok:false,actorId:null,code:'INVALID_CREDENTIALS'};}
/**
 * Persistent throttling by login fingerprint. Usernames and passwords
 * never enter login audit records. This transaction is serialized per handle.
 * DB MUST be isolated by the service's configured DATABASE_URL.
 */
export async function verifyPersonalLogin(query,login,passphrase){
 const handle=normalizeHandle(login);
 if(!handle||!eligiblePassword(passphrase))return rejected();
 const fp=createHash('sha256').update('cisne-login/v1:'+handle).digest('hex');
 await query(`INSERT INTO cisne_login_attempts(login_fingerprint) VALUES($1)
  ON CONFLICT(login_fingerprint) DO NOTHING`,[fp]);
 const lock=await query('SELECT failures,locked_until FROM cisne_login_attempts WHERE login_fingerprint=$1 FOR UPDATE',[fp]);
 const lockedUntil=lock.rows[0]?.locked_until?new Date(lock.rows[0].locked_until).getTime():0;
 if(lockedUntil>Date.now()){
  await query("INSERT INTO cisne_login_audit(id,outcome) VALUES($1,'locked')",[randomUUID()]);
  return rejected();
 }
 const result=await query('SELECT actor_id,salt,password_hash,enabled FROM cisne_login_accounts WHERE login_handle=$1',[handle]);
 const row=result.rows[0];
 const salt=row?Buffer.from(row.salt):fakeSalt;
 const expected=row?Buffer.from(row.password_hash):fakeDigest;
 const computed=await scrypt(passphrase,salt,64,policy);
 let valid=Boolean(row?.enabled&&equalHash(computed,expected));
 if(valid){
  const member=await query(`SELECT 1 FROM enterprise_tenant_memberships m
   JOIN enterprise_tenants t ON t.id=m.tenant_id
   WHERE m.actor_id=$1 AND m.status='active' AND t.status='active' LIMIT 1`,[row.actor_id]);
  valid=member.rows.length>0;
 }
 if(!valid){
  await query(`UPDATE cisne_login_attempts SET failures=LEAST(failures+1,10000),
   locked_until=CASE WHEN failures+1>=5 THEN now()+interval '15 minutes' ELSE NULL END,
   updated_at=now() WHERE login_fingerprint=$1`,[fp]);
  await query("INSERT INTO cisne_login_audit(id,actor_id,outcome) VALUES($1,$2,'denied')",[randomUUID(),row?.actor_id??null]);
  return rejected();
 }
 await query('UPDATE cisne_login_attempts SET failures=0,locked_until=NULL,updated_at=now() WHERE login_fingerprint=$1',[fp]);
 await query("INSERT INTO cisne_login_audit(id,actor_id,outcome) VALUES($1,$2,'accepted')",[randomUUID(),row.actor_id]);
 return {ok:true,actorId:String(row.actor_id)};
}
