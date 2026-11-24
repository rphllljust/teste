import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const page=readFileSync(new URL('../../../app/page.tsx',import.meta.url),'utf8');
const workspace=readFileSync(new URL('../../../app/CRMWorkspace.tsx',import.meta.url),'utf8');
const route=readFileSync(new URL('../../../app/api/crm/route.ts',import.meta.url),'utf8');

test('CRM is part of the Field module router, not a separate window or iframe',()=>{
  assert.match(page,/item\("crm", "CRM e Vendas", "people"\)/);
  assert.match(page,/page==='CRM e Vendas'\?<CRMWorkspace/);
  assert.doesNotMatch(page,/NextcrmLaunchLink|crmUrl|window\.open\(/);
  assert.doesNotMatch(workspace,/<iframe|target="_blank"|nextcrm-gateway-staging/);
});

test('native CRM takes facts from authenticated API and never fabricates data',()=>{
  assert.match(workspace,/fetch\('\/api\/crm'/);
  assert.match(workspace,/if\(!response\.ok\)throw new Error/);
  assert.match(workspace,/snapshot\?snapshot\.totals\.leads:'—'/);
  assert.match(workspace,/response=await fetch\('\/api\/crm',\{method:'POST'/);
  assert.doesNotMatch(workspace,/localStorage|sessionStorage|demoData|mockData/);
});

test('server owns the tenant identity and mutations use transactional receipts',()=>{
  assert.match(route,/requestContext\(request,true\)/);
  assert.match(route,/database\(\)\.transaction/);
  assert.match(route,/INSERT INTO crm_commands/);
  assert.match(route,/owner_id=\?/);
  assert.doesNotMatch(route,/request\.headers\.get\('x-actor-id'\)|body\.actorId/);
});

test('OS detail shows only server-authorized NextCRM document metadata',()=>{
  const documents=readFileSync(new URL('../../../app/OrderNextcrmDocuments.tsx',import.meta.url),'utf8');
  assert.match(page,/OrderNextcrmDocuments key=\{selected\.id\}/);
  assert.match(documents,/\/api\/orders\//);
  assert.match(documents,/cache:'no-store'/);
  assert.match(documents,/result\?\.enabled===false/);
  assert.match(documents,/result\?\.enabled===true/);
  assert.doesNotMatch(documents,/localStorage|sessionStorage|<iframe|window\.open|downloadUrl|signedUrl/);
});
