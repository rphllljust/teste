import { readFile } from 'node:fs/promises';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateNextcrmNetworkTopology(c) {
  const issues=[];
  const check=(ok,message)=>{if(!ok)issues.push(message);};
  check(c?.revision==='2026-11-15-staging-private-network','Version not reviewed');
  check(c?.status==='STAGED_NOT_DEPLOYED','Must remain staged only before independent deploy approval');
  const e=c?.environment??{};
  check(e.name==='staging'&&e.projectName==='genuine-renewal','Incorrect Railway staging environment');
  check(UUID.test(e.projectId||'')&&UUID.test(e.id||'')&&UUID.test(e.patchId||''),'Missing Railway environment evidence');
  check(e.projectId==='0835d357-6037-42e6-a534-6456422e1cf3'&&
    e.id==='c241a855-68b7-4d75-a722-b6a42c8581e9','Project/environment mismatch');
  const services=c?.nextcrm?.services??{}, erp=c?.erp??{};
  check(c?.nextcrm?.serviceUrl==='http://nextcrm-web.railway.internal:3000','Bridge must use same-project private DNS');
  check(c?.nextcrm?.publicEntryService==='nextcrm-gateway','Only the gateway may receive a public domain');
  const serviceNames=new Set(),serviceIds=new Set();
  for(const kind of ['web','postgres','minio','jobs','gateway']){
    const s=services[kind]??{};
    check(s.name==='nextcrm-'+kind, 'Unexpected NextCRM service name: '+kind);
    check(UUID.test(s.id||''), 'Missing staged service ID: '+kind);
    serviceNames.add(s.name);serviceIds.add(s.id);
  }
  check(serviceNames.size===5&&serviceIds.size===5,'NextCRM services must be distinct');
  check(erp?.web?.name==='cisne-web-staging'&&UUID.test(erp?.web?.id||''),'ERP web identity missing');
  check(erp?.postgres?.name==='Postgres'&&UUID.test(erp?.postgres?.id||''),'ERP database identity missing');
  check(!serviceIds.has(erp?.web?.id)&&!serviceIds.has(erp?.postgres?.id),
    'NextCRM must not share ERP app or database service');
  const mounts={web:'/app/data',postgres:'/var/lib/postgresql/data',minio:'/data',jobs:'/var/lib/inngest'};
  const volIds=new Set();
  for(const [kind,mount] of Object.entries(mounts)){
    const vol=c?.nextcrm?.volumes?.[kind]??{};
    check(vol.name==='nextcrm-'+kind+'-data'&&vol.mountPath===mount,
      'Unexpected persistent volume mount: '+kind);
    check(UUID.test(vol.id||''),'Missing volume ID: '+kind);
    volIds.add(vol.id);
  }
  check(volIds.size===4,'Volumes must be distinct');
  const old=c?.obsoleteStagedProject??{};
  check(old.doNotApply===true&&UUID.test(old.projectId||'')&&old.projectId!==e.projectId,
    'Old cross-project patch must remain blocked');
  return issues;
}
const config=JSON.parse(await readFile(new URL('../config/nextcrm-staging-topology.json',import.meta.url),'utf8'));
const issues=validateNextcrmNetworkTopology(config);
if(issues.length){for(const issue of issues)console.error('NO-GO: '+issue);process.exitCode=1;}
else console.log('PASS: staged NextCRM and ERP share the same Railway staging project/environment. This checks recorded topology only, not live Railway state.');
