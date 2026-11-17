// Standalone Cloudflare workerd/Miniflare concurrency harness (not Railway).
// Uses synthetic nonsecret credentials, never reaches a database.
import { stagingBoundaryError } from '../../lib/api/staging-access.mjs';
import { withRC98SignedDbScope } from '../../lib/api/staging-uat-db-scope.mjs';
import { rc98PgPoolMode } from '../../db/uat-pool-policy.mjs';

const actor = 'rc98-worker-scope-synthetic';
const e = Object.freeze({
  RAILWAY_PROJECT_ID:'0835d357-6037-42e6-a534-6456422e1cf3',
  RAILWAY_ENVIRONMENT_ID:'c241a855-68b7-4d75-a722-b6a42c8581e9',
  RAILWAY_ENVIRONMENT_NAME:'staging',
  RAILWAY_SERVICE_ID:'fed95ca7-f373-4e6a-983f-2f591f26672e',
  RAILWAY_SERVICE_NAME:'cisne-rc85-ephemeral-erp',
  CISNE_STAGING_ACCESS_MODE:'private',
  CISNE_STAGING_READ_ONLY:'true',
  CISNE_STAGING_ACTOR_ID:actor,
  CISNE_STAGING_SESSION_SECRET:'synthetic-rc98-worker-scope-cookie-secret-64bytes',
  CISNE_RC95_UAT_ENABLED:'true',
  CISNE_RC95_UAT_ACTOR_ID:actor,
  CISNE_RC95_UAT_SIGNING_KEY:'d'.repeat(64),
  CISNE_RC95_UAT_UNTIL_MS: String(Date.now()+300000),
});
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const type = request.headers.get('x-rc98-test-delay') || 'fast';
    const cloned = new Request('http://cisne-rc85-ephemeral-erp.railway.internal:8080'+url.pathname,{
      method: request.method,
      headers: request.headers,
      body: ['GET','HEAD'].includes(request.method) ? undefined : '{}',
    });
    return withRC98SignedDbScope(cloned,async()=>{
      const err=stagingBoundaryError(cloned,e);
      // Deliberately await after establishing the permission to test whether
      // real Workerd request contexts cross-contaminate on concurrent fetch.
      await new Promise(resolve=>setTimeout(resolve,type==='slow'?25:1));
      return Response.json({
        status:err?.status??200,
        sqlMode:rc98PgPoolMode(e).mode,
        scopeProbe:true,
      });
    },e);
  }
};
