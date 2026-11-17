// Reviewed, exact destination identities. Never derive these from browser input.
// The isolated targets are enabled only when the runtime is staging (or local
// test); existing production / legacy defaults remain unchanged.
const OLD_BRIDGE='http://nextcrm-web.railway.internal:3000';
const ISOLATED_BRIDGE='http://nextcrm-rc84-isolated-web.railway.internal:3000';
const OLD_MINIO='https://nextcrm-minio-staging.up.railway.app';
const ISOLATED_MINIO='https://nextcrm-rc84-isolated-minio-staging.up.railway.app';

export function selectedNextcrmPrivateBridge(env=process.env) {
  const configured=env.CISNE_NEXTCRM_PRIVATE_ORIGIN;
  // An invalid configured value MUST fail downstream validation, never fall
  // back to the old live CRM by silently ignoring a staging configuration.
  return env.RAILWAY_ENVIRONMENT_NAME==='staging' && configured
    ? configured : OLD_BRIDGE;
}
export function approvedNextcrmPrivateBridge(value,env=process.env){
  try {
    const u=new URL(value);
    if(u.username||u.password||u.search||u.hash||
       (u.pathname!=='/'&&u.pathname!==''))return false;
    return u.href===OLD_BRIDGE+'/' ||
      ((env.RAILWAY_ENVIRONMENT_NAME==='staging'||env.NODE_ENV==='test')&&
       u.href===ISOLATED_BRIDGE+'/');
  }catch{return false;}
}
export function approvedNextcrmMinioOrigin(value,env=process.env){
  try {
    const u=new URL(value);
    if(u.protocol!=='https:'||u.username||u.password||u.port||
       (u.pathname!=='/'&&u.pathname!=='')||u.search||u.hash)return false;
    return u.origin===OLD_MINIO ||
      ((env.RAILWAY_ENVIRONMENT_NAME==='staging'||env.NODE_ENV==='test')&&
       u.origin===ISOLATED_MINIO);
  }catch{return false;}
}
