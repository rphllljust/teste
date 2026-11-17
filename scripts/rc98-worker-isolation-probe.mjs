import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { issueStagingSession, CISNE_STAGING_COOKIE } from '../lib/api/staging-session.mjs';
import { issueRC95UatToken } from '../lib/api/staging-uat-mutation.mjs';

if(process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true')
  throw Error('RC98_ONLY_DISPOSABLE_GITHUB_WORKER_FIXTURE');
const port=18788;
const base='http://127.0.0.1:'+port;
const actor='rc98-worker-scope-synthetic';
const secret='synthetic-rc98-worker-scope-cookie-secret-64bytes';
const signing='d'.repeat(64);
const wrangler=spawn(process.execPath,[
  './node_modules/wrangler/bin/wrangler.js','dev',
  'ops/railway-functions/rc98-worker-context-harness.mjs',
  '--local','--ip','127.0.0.1','--port',String(port),
  '--compatibility-date','2026-11-01',
  '--compatibility-flags','nodejs_compat',
  '--inspector-port','0',
],{
  env:{...process.env,WRANGLER_SEND_METRICS:'false',CI:'true'},
  stdio:['ignore','pipe','pipe'],
});
let errorOutput='';
for(const stream of [wrangler.stderr,wrangler.stdout]){
  stream.on('data',chunk=>{errorOutput+=(chunk.toString()).slice(0,2000);
    if(errorOutput.length>12000)errorOutput=errorOutput.slice(-12000);});
}
const headers=(method,signed,delay)=>{
  const token=issueStagingSession(actor,secret);
  const request=new Request(base+'/api/orders',{
    method,headers:{cookie:CISNE_STAGING_COOKIE+'='+token,
      'content-type':'application/json'},
  });
  const h={'cookie':CISNE_STAGING_COOKIE+'='+token,
    'content-type':'application/json','x-rc98-test-delay':delay};
  if(signed)h['x-cisne-rc95-uat']=issueRC95UatToken(request,actor,signing);
  return h;
};
const scenario=async(method,signed,delay)=>{
  const response=await fetch(base+'/api/orders',{
    method,headers:headers(method,signed,delay),
    body:method==='POST'?'{}':undefined,
    signal:AbortSignal.timeout(8000),
  });
  assert.equal(response.status,200);
  const json=await response.json();
  assert.equal(json.scopeProbe,true);
  return json;
};

try{
  let ready=false;
  for(let attempt=0;attempt<80;attempt++){
    if(wrangler.exitCode!==null)throw Error('RC98_WORKER_EXITED');
    try{await scenario('GET',false,'fast');ready=true;break;}
    catch{await sleep(200);}
  }
  if(!ready)throw Error('RC98_WORKER_NOT_READY');
  for(let i=0;i<35;i++){
    const [writer,denied,reader]=await Promise.all([
      scenario('POST',true,'slow'),
      scenario('POST',false,'fast'),
      scenario('GET',false,'fast'),
    ]);
    assert.deepEqual(writer,{status:200,sqlMode:'synthetic-write',scopeProbe:true},'signed mutation '+i);
    assert.deepEqual(denied,{status:403,sqlMode:'read-only',scopeProbe:true},'unsigned mutation '+i);
    assert.deepEqual(reader,{status:200,sqlMode:'read-only',scopeProbe:true},'authenticated reader '+i);
  }
  console.log('RC98_REAL_WORKER_CONTEXT_ISOLATION_PASS concurrentRounds=35 signedPost=writer unsignedPost=readonly authenticatedGet=readonly');
}catch(e){
  const category=e instanceof Error?e.message.slice(0,140):'UNKNOWN';
  console.error('RC98_REAL_WORKER_CONTEXT_ISOLATION_NO_GO',category);
  console.error('RC98_WORKER_LOG_TAIL',errorOutput.slice(-2300).replace(/token|secret|password/ig,'[REDACTED]'));
  process.exitCode=1;
}finally{
  wrangler.kill('SIGTERM');
  await sleep(400);
  if(wrangler.exitCode===null)wrangler.kill('SIGKILL');
}
