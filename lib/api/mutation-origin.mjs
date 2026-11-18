/**
 * Compare browser mutation origins against the canonical public origin in
 * Railway staging. Reverse proxies can expose an internal http Request.url
 * while the browser sends the legitimate external https Origin.
 *
 * Requests without Origin keep the pre-existing server-to-server contract;
 * staging identity is still required via the signed HttpOnly session.
 */
export function mutationOriginAllowed(request, env=process.env) {
  const origin=request.headers.get('origin');
  if(!origin)return true;
  if(env.RAILWAY_ENVIRONMENT_NAME==='staging'){
    const publicOrigin=env.CISNE_STAGING_PUBLIC_ORIGIN;
    return typeof publicOrigin==='string' &&
      /^https:\/\/cisne-web-staging-staging[.]up[.]railway[.]app$/.test(publicOrigin) &&
      origin===publicOrigin;
  }
  return origin===new URL(request.url).origin;
}
