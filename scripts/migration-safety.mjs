import { createHash } from 'node:crypto';

// The evidence is an operator attestation, not a Railway backup API response.
// It only authorizes the exact immutable SQL bytes after a documented restore
// drill on a *different* database. No automated deploy may fabricate it.
export const PROTECTED_MIGRATION='0002_crm_proposal_origin';
export function sqlDigest(sql){
  return createHash('sha256').update(sql,'utf8').digest('hex');
}
function disposableCiDatabase(env){
  if(env.NODE_ENV!=='test'||env.GITHUB_ACTIONS!=='true'||env.CI!=='true')return false;
  try{
    const url=new URL(env.DATABASE_URL||'');
    return url.protocol==='postgresql:'&&
      ['localhost','127.0.0.1'].includes(url.hostname)&&
      ['/cisne_test','/cisne_ci'].includes(url.pathname)&&url.port==='5432';
  }catch{return false;}
}
export function validateRestoreAttestation({migrationId,sql,env=process.env,now=Date.now()}){
  // The fixed, isolated GitHub Actions postgres:16 fixture has no persistent
  // records and no real backup. Other targets always require a restore drill.
  if(disposableCiDatabase(env))return {kind:'ci-disposable'};
  const digest=sqlDigest(sql);
  let evidence;
  try{evidence=JSON.parse(env.CISNE_DB_RESTORE_ATTESTATION||'');}
  catch{throw Error('MIGRATION_BACKUP_NO_GO: missing or malformed restore attestation');}
  if(!evidence||typeof evidence!=='object'||Array.isArray(evidence))
    throw Error('MIGRATION_BACKUP_NO_GO: restore evidence must be an object');
  const field=(name,max=160)=>
    typeof evidence[name]==='string'&&evidence[name].length>=3&&
    evidence[name].length<=max&&/^[a-zA-Z0-9_.:@-]+$/.test(evidence[name]);
  if(evidence.migrationId!==migrationId||evidence.migrationSha256!==digest)
    throw Error('MIGRATION_BACKUP_NO_GO: evidence does not match the exact migration SQL');
  if(!field('backupId')||!field('restoreTarget')||!field('verifiedBy'))
    throw Error('MIGRATION_BACKUP_NO_GO: backup ID, separate restore target and verifier required');
  try{
    const source=new URL(env.DATABASE_URL||'');
    if(evidence.restoreTarget===decodeURIComponent(source.pathname.slice(1)))
      throw Error('MIGRATION_BACKUP_NO_GO: restore target must differ from the source database');
  }catch(err){
    if(err instanceof Error&&err.message.startsWith('MIGRATION_BACKUP_NO_GO'))throw err;
    throw Error('MIGRATION_BACKUP_NO_GO: DATABASE_URL missing or invalid');
  }
  if(typeof evidence.verifiedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(evidence.verifiedAt))
    throw Error('MIGRATION_BACKUP_NO_GO: UTC restore verification timestamp required');
  const timestamp=Date.parse(evidence.verifiedAt);
  if(!Number.isFinite(timestamp)||timestamp>now+5*60_000||timestamp<now-72*60*60_000)
    throw Error('MIGRATION_BACKUP_NO_GO: restore verification is stale or in the future');
  return {kind:'attested',migrationId,digest,backupId:evidence.backupId,
    restoreTarget:evidence.restoreTarget,verifiedAt:evidence.verifiedAt};
}