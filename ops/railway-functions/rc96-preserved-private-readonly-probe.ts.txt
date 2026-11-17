// RC92 POST-MIGRATION VERIFICATION: private HTTP and read-only/anonymous auth controls.
const PROJECT='0835d357-6037-42e6-a534-6456422e1cf3';
const ENVIRONMENT='c241a855-68b7-4d75-a722-b6a42c8581e9';
const ERP='cisne-rc85-ephemeral-erp.railway.internal';
if(Bun.env.RAILWAY_PROJECT_ID!==PROJECT || Bun.env.RAILWAY_ENVIRONMENT_ID!==ENVIRONMENT ||
   Bun.env.RAILWAY_ENVIRONMENT_NAME!=='staging') {
  console.error('RC86_PRIVATE_PROBE_NO_GO_WRONG_RAILWAY_ENVIRONMENT');
  process.exit(91);
}
let candidate:{port:number;status:number;responseStatus:string}|null=null;
const errors:string[]=[];
for(const port of [8787,3000,8080]){
  try {
    const response=await fetch('http://'+ERP+':'+port+'/api/health/ready',
      {signal:AbortSignal.timeout(4500),redirect:'error',cache:'no-store'});
    const raw=await response.text();
    const json=JSON.parse(raw);
    if(![200,503].includes(response.status) ||
       !['ready','unavailable'].includes(json?.status) ||
       response.headers.get('content-type')?.includes('application/json')!==true){
      errors.push('UNRECOGNIZED_PRIVATE_READINESS_'+port);
      continue;
    }
    candidate={port,status:response.status,responseStatus:json.status};
    break;
  } catch {
    errors.push('NO_PRIVATE_HTTP_AT_PORT_'+port);
  }
}
if(!candidate){
  console.error('RC92_PRIVATE_HTTP_NO_GO',JSON.stringify({reason:'NO_EXPECTED_PRIVATE_READINESS',categories:errors}));
  process.exit(92);
}
const base='http://'+ERP+':'+candidate.port;
const observations:{name:string;status:number|undefined}[]=[];
for(const spec of [
  {name:'ANONYMOUS_ORDERS_GET',method:'GET',path:'/api/orders'},
  {name:'ANONYMOUS_ORDERS_POST_INVALID_BODY',method:'POST',path:'/api/orders'},
]){
  try{
    const response=await fetch(base+spec.path,{
      method:spec.method,headers:spec.method==='POST'?{'content-type':'application/json'}:{},
      body:spec.method==='POST'?'{}':undefined,
      signal:AbortSignal.timeout(4500),redirect:'error',cache:'no-store',
    });
    await response.body?.cancel();
    observations.push({name:spec.name,status:response.status});
  }catch{observations.push({name:spec.name,status:undefined});}
}
const denied=observations.every(x=>x.status===403);
const ready=candidate.status===200&&candidate.responseStatus==='ready';
console.log('RC92_PRIVATE_READONLY_HTTP_EVIDENCE',JSON.stringify({
  reachability:'PRIVATE_HTTP_REACHED',
  readiness:ready?'PASS':'NOT_READY',
  readinessStatus:candidate.status,
  anonymousAccess:denied?'DENIED':'NO_GO',
  observations,
}));
if(!denied||!ready){
  console.error('RC92_PRIVATE_HTTP_NO_GO',JSON.stringify({
    category:!denied?'AUTHORIZATION_OR_READONLY_FAILED':'DATABASE_READINESS_UNVERIFIED',
  }));
  // Report a negative verdict, but complete the one-time diagnostic without restarts.
  process.exitCode=1;
}
