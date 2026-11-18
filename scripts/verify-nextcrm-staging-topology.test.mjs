import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateNextcrmNetworkTopology } from './verify-nextcrm-staging-topology.mjs';
const good=JSON.parse(await readFile(new URL('../config/nextcrm-staging-topology.json',import.meta.url),'utf8'));
test('recorded ERP+NextCRM network topology remains same-project staged only',()=>{
  assert.deepEqual(validateNextcrmNetworkTopology(good),[]);
});
test('separate project, stale patch and public destination are rejected',()=>{
  for(const mutate of [
    c=>c.environment.projectId=c.obsoleteStagedProject.projectId,
    c=>c.nextcrm.serviceUrl='https://nextcrm.staging.invalid',
    c=>c.status='DEPLOYED',
    c=>c.obsoleteStagedProject.doNotApply=false,
    c=>c.nextcrm.services.postgres.id=c.erp.postgres.id,
  ]){
    const c=structuredClone(good);mutate(c);assert.ok(validateNextcrmNetworkTopology(c).length);
  }
});
