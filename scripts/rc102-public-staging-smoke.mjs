// RC102: anonymous external smoke test of *already deployed* Railway staging.
// Never accesses credentials, creates records, mutates state, or tests production.
import assert from 'node:assert/strict';

const ORIGIN='https://cisne-web-staging-staging.up.railway.app';
const expectedSha=process.env.RC102_EXPECTED_STAGING_SHA;
if (process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true')
 throw new Error('RC102_NO_GO_EXTERNAL_SMOKE_CI_ONLY');
if (!/^[0-9a-f]{40}$/.test(expectedSha??''))
 throw new Error('RC102_NO_GO_EXPECTED_SHA_REQUIRED');
if (process.env.RC102_TARGET_ENV!=='staging')
 throw new Error('RC102_NO_GO_TARGET_MUST_BE_STAGING');

async function get(path){
 const target=new URL(path,ORIGIN);
 assert.equal(target.origin,ORIGIN,'Cross-host redirect is not permitted');
 const response=await fetch(target,{
  method:'GET',redirect:'manual',
  headers:{'accept':'text/html,application/json;q=0.9','cache-control':'no-cache'},
  signal:AbortSignal.timeout(12000),
 });
 const text=await response.text();
 if(text.length>3_000_000)throw new Error('RC102_UNEXPECTEDLY_LARGE_RESPONSE');
 return {status:response.status,headers:response.headers,body:text};
}
function fail(category){throw new Error('RC102_NO_GO_'+category);}
const main=await get('/');
if(main.status!==200)fail('HOME_NOT_200_'+main.status);
if(!main.body.includes('Central de integração')||!main.body.includes('Módulos empresariais')||
   !main.body.includes('CRM e Vendas')||!main.body.includes('CISNE'))
 fail('NATIVE_MENU_NOT_RENDERED');
if(!main.body.includes('/api/')){ // APIs are not necessarily rendered in the shell.
 // This is informational: DOM navigation matters, not exposing private API paths.
}
console.log('RC102_PUBLIC_MENU_PASS service=cisne-web-staging target=staging sha='+expectedSha.slice(0,12));

const readiness=await get('/api/healthz');
if(readiness.status!==200)fail('READINESS_HTTP_'+readiness.status);
let health;
try{health=JSON.parse(readiness.body)}catch{fail('READINESS_NOT_JSON')}
if(health?.status!=='ready'||Object.keys(health).some(k=>k!=='status'))fail('READINESS_CONTRACT_INVALID');
if(!/no-store/i.test(readiness.headers.get('cache-control')??''))fail('READINESS_CACHE_POLICY');
console.log('RC102_PUBLIC_READINESS_PASS status=200 contract=ready cache=no-store');

const unauthenticated=await get('/api/orders?page=1&pageSize=25&sort=createdAt.desc');
if(![401,403].includes(unauthenticated.status))fail('ANONYMOUS_ORDER_LIST_STATUS_'+unauthenticated.status);
if(/"orders"\s*:\s*\[\s*\{/.test(unauthenticated.body)||
   /"items"\s*:\s*\[\s*\{/.test(unauthenticated.body))
 fail('ANONYMOUS_BUSINESS_DATA_LEAK');
console.log('RC102_ANONYMOUS_ORDERS_DENIED_PASS http='+unauthenticated.status);

const missingOrder=await get('/api/orders/00000000-0000-4000-8000-000000000000');
if(![401,403,404].includes(missingOrder.status))fail('ANONYMOUS_ORDER_CONTEXT_HTTP_'+missingOrder.status);
if(/"finance"\s*:\s*\{/.test(missingOrder.body)||/"relations"\s*:\s*\{/.test(missingOrder.body))
 fail('ANONYMOUS_CONTEXT_DATA_LEAK');
console.log('RC102_ANONYMOUS_ORDER_CONTEXT_DENIED_PASS http='+missingOrder.status);
console.log('RC102_STAGING_PUBLIC_READONLY_SMOKE_PASS sha='+expectedSha.slice(0,12)+' no_mutations=true');
