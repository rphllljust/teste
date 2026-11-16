/**
 * Railway preview/homologation origins are deployment-specific. The trusted
 * operator configures ONE canonical public origin per service, never a suffix
 * accepted from arbitrary requests, forwarding headers or untrusted payloads.
 *
 * Preview access remains fail-closed unless the origin is exact HTTPS at the
 * Railway-managed domain. Custom domains require a separately reviewed policy.
 */
export function approvedStagingPublicOrigin(env=process.env) {
  if(env.RAILWAY_ENVIRONMENT_NAME!=='staging'&&env.RAILWAY_ENVIRONMENT!=='staging'&&env.CISNE_STAGING_UAT!=='true')return null;
  const value=env.CISNE_STAGING_PUBLIC_ORIGIN;
  if(typeof value!=='string'||value.length>180)return null;
  if(!/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.up\.railway\.app$/.test(value))
    return null;
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'||url.origin!==value||url.port||
       url.username||url.password||url.search||url.hash)return null;
    return value;
  }catch{return null;}
}
