// Explicit, staging-only trusted-operator provisioning. No public enrollment endpoint.
// Usage: set CISNE_ENROLL_ACTOR_ID, CISNE_ENROLL_LOGIN, CISNE_ENROLL_CONFIRM,
// RAILWAY_ENVIRONMENT_NAME=staging and DATABASE_URL; pipe a NEW strong
// passphrase on stdin. Never pass passwords in CLI arguments or commit them.
import {Pool} from 'pg';
import {hashPersonalPassword,normalizeHandle,eligiblePassword} from '../lib/api/personal-login.mjs';

if(process.env.RAILWAY_ENVIRONMENT_NAME!=='staging'||
   process.env.CISNE_ENROLL_CONFIRM!=='YES_PROVISION_IN_STAGING'||
   !process.env.DATABASE_URL)
 throw Error('PERSONAL_ENROLLMENT_DISABLED');
const actor=process.env.CISNE_ENROLL_ACTOR_ID;
const handle=normalizeHandle(process.env.CISNE_ENROLL_LOGIN);
if(typeof actor!=='string'||actor.length<8||actor.length>200||!handle)
 throw Error('PERSONAL_ENROLLMENT_INVALID_IDENTITY');
let password='';
for await(const piece of process.stdin){
 password+=piece.toString('utf8');
 if(password.length>164)throw Error('PERSONAL_ENROLLMENT_PASSWORD_TOO_LONG');
}
password=password.replace(/\r?\n$/,'');
if(!eligiblePassword(password))throw Error('PERSONAL_ENROLLMENT_PASSWORD_POLICY');
const {salt,hash}=await hashPersonalPassword(password);
password='';
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000});
const client=await pool.connect();
try{
 await client.query('BEGIN');
 const active=await client.query(`SELECT m.role,m.tenant_id FROM enterprise_tenant_memberships m
 JOIN enterprise_tenants t ON t.id=m.tenant_id
 WHERE m.actor_id=$1 AND m.status='active' AND t.status='active' FOR SHARE OF m,t`,[actor]);
 let eligible=false;
 for(const row of active.rows){
  if(row.role==='owner'){
   const owner=await client.query(`SELECT 1 FROM cisne_erp_owner_declarations
    WHERE identity_actor_id=$1 AND identity_state='verified'
      AND owner_key IN ('abrahim','rafael')`,[actor]);
   eligible=eligible||owner.rows.length>0;
  }else if(row.role==='operator'){
   const link=await client.query('SELECT 1 FROM svc_employee_links WHERE tenant_id=$1 AND employee_actor_id=$2',[row.tenant_id,actor]);
   eligible=eligible||link.rows.length>0;
  }
 }
 if(!eligible)throw Error('PERSONAL_ENROLLMENT_REQUIRES_VERIFIED_OWNER_OR_LINKED_EMPLOYEE');
 const existing=await client.query('SELECT 1 FROM cisne_login_accounts WHERE actor_id=$1 OR login_handle=$2',[actor,handle]);
 if(existing.rows.length)throw Error('PERSONAL_ENROLLMENT_ALREADY_EXISTS_ROTATE_SEPARATELY');
 await client.query(`INSERT INTO cisne_login_accounts(actor_id,login_handle,salt,password_hash)
  VALUES($1,$2,$3,$4)`,[actor,handle,salt,hash]);
 await client.query('COMMIT');
 console.info('CISNE_PERSONAL_LOGIN_PROVISIONED: staging actor eligibility verified; no credential values emitted');
}catch(error){
 await client.query('ROLLBACK').catch(()=>{});
 throw error;
}finally{client.release();await pool.end();}
