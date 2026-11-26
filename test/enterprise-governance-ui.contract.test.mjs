import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const [page,shell]=await Promise.all([
 readFile(new URL('../app/enterprise/page.tsx',import.meta.url),'utf8'),
 readFile(new URL('../app/page.tsx',import.meta.url),'utf8'),
]);
test('business governance is reachable from ERP and exposes only native authenticated routes',()=>{
 assert.match(shell,/href="\/enterprise"/);
 for(const endpoint of ['/api/enterprise/tenants','/legal-entities','/members']){
  assert.ok(page.includes(endpoint),'Missing endpoint '+endpoint);
 }
 assert.match(page,/setTenantId/);
 assert.match(page,/member.*status|m\.status/);
 assert.match(page,/role!=='owner'/);
 assert.doesNotMatch(page,/oai-authenticated-user-id/);
 assert.doesNotMatch(page,/localStorage/);
});
test('business governance requires explicit consent per mutation and shows failures',()=>{
 assert.match(page,/onSubmit=\{createTenant\}/);
 assert.match(page,/onSubmit=\{createCompany\}/);
 assert.match(page,/onSubmit=\{provision\}/);
 assert.match(page,/onClick=\{\(\)=>void deactivate\(m\.actorId\)\}/);
 assert.match(page,/role="alert"/);
 assert.match(page,/disabled=\{saving\}/);
});

test('enterprise object details share a factual status and relationship header',async()=>{
 const primitives=await readFile(new URL('../app/components/enterprise/EnterprisePrimitives.tsx',import.meta.url),'utf8');
 const foundation=await readFile(new URL('../app/components/enterprise/enterprise-foundation.css',import.meta.url),'utf8');
 assert.match(primitives,/export function EnterpriseObjectSummary/);
 assert.match(primitives,/aria-label=\{type \+ ': ' \+ title\}/);
 assert.match(primitives,/facts\.map/);
 assert.match(foundation,/\.enterprise-object-summary/);
 for (const path of ['ClientsWorkspace.tsx','ProposalsWorkspace.tsx','ContractsWorkspace.tsx','AccountingWorkspace.tsx']){
  const source=await readFile(new URL('../app/'+path,import.meta.url),'utf8');
  assert.match(source,/<EnterpriseObjectSummary/,'Object summary must be used by '+path);
 }
});
test('operational cockpit never counts draft orders as approved work or all non-drafts as executing',async()=>{
 const cockpit=await readFile(new URL('../app/EnterpriseCommandCenter.tsx',import.meta.url),'utf8');
 assert.match(cockpit,/OS em preparação/);
 assert.match(cockpit,/Ordens fora de rascunho/);
 assert.doesNotMatch(cockpit,/Aprovações pendentes/);
 assert.doesNotMatch(cockpit,/Ordens em execução/);
});


test('document details share a single accessible section navigation with observed active location',async()=>{
 const primitives=await readFile(new URL('../app/components/enterprise/EnterprisePrimitives.tsx',import.meta.url),'utf8');
 assert.match(primitives,/export function EnterpriseObjectSectionNavigation/);
 assert.match(primitives,/closest\('\.drawer'\)/);
 assert.match(primitives,/rootMargin: '-135px/);
 assert.match(primitives,/aria-current=\{active === section\.id \? 'location'/);
 for(const file of ['ClientsWorkspace.tsx','ProposalsWorkspace.tsx','ContractsWorkspace.tsx','AccountingWorkspace.tsx']){
  const src=await readFile(new URL('../app/'+file,import.meta.url),'utf8');
  assert.match(src, /<EnterpriseObjectSectionNavigation/,'missing shared navigation: '+file);
  assert.match(src, /className="drawer enterprise-object-detail"/,'missing responsive Object Page: '+file);
  assert.doesNotMatch(src, /<nav className="object-anchors"/,'duplicate local Object Page navigation: '+file);
 }
});
