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
