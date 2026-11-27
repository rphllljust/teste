import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const browser=read('test/hml-live-acceptance.mjs');
const workflow=read('.github/workflows/cisne-hml-live-acceptance.yml');
const doc=read('docs/enterprise/hml-live-browser-acceptance.md');

test('HML browser is pinned to actual Railway Staging and never changes business data',()=>{
  assert.match(browser,/base\.origin !== 'https:\/\/cisne-web-staging-staging\.up\.railway\.app'/);
  assert.match(browser,/chromium\.launch\(\{ headless:true \}\)/);
  assert.match(browser,/1440, height:900/);
  assert.match(browser,/768, height:1024/);
  assert.match(browser,/390, height:844/);
  assert.match(browser,/page\.getByRole\('heading',\{name:'Dossiês empresariais'/);
  assert.match(browser,/\.enterprise-dossier-auth input\[name="passphrase"\]\[type="password"\]/);
  assert.match(browser,/name:'Entrar nos Dossiês',exact:true/);
  assert.doesNotMatch(browser,/\/api\/enterprise\/journeys.*method:\s*'POST'/);
  assert.doesNotMatch(browser,/console\.(?:log|error)\(secret\)/);
});

test('HML denies anonymous and spoofed actors before using an authenticated session',()=>{
  assert.match(browser,/assert\.equal\(unauth\.status\(\),403/);
  assert.match(browser,/assert\.equal\(impersonated\.status\(\),403/);
  assert.match(browser,/assert\.equal\(unauthorizedDetail\.status\(\),403/);
  assert.match(browser,/oai-authenticated-user-id/);
  assert.match(browser,/x-cisne-dispatch-secret/);
  assert.match(browser,/if\(!secret\)/);
  assert.match(browser,/if\(requireAuth\)throw new Error\('NO_GO/);
  assert.match(browser,/context\.request\.post\(base\.origin \+ '\/api\/auth\/staging-login'/);
});

test('screenshots are captured before login and only from anonymous views',()=>{
  const screenshot=browser.indexOf('page.screenshot(');
  const login=browser.indexOf("context.request.post(base.origin + '/api/auth/staging-login'");
  assert.ok(screenshot>=0 && login>screenshot);
  assert.match(browser,/unauthenticated-'\+profile\.name/);
  assert.match(workflow,/actions\/upload-artifact@v4/);
  assert.match(workflow,/unauthenticated-\*\.png/);
  assert.match(workflow,/retention-days: 3/);
});

test('encrypted credential is optional on PR but full manual HML is fail-closed',()=>{
  assert.match(workflow,/playwright@1\.65\.1/);
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/pull_request:/);
  assert.match(workflow,/secrets\.CISNE_HML_LOGIN_PASSPHRASE/);
  assert.match(workflow,/inputs\.require_authenticated/);
  assert.match(browser,/HML_ACCEPTANCE_VERDICT/);
  assert.match(doc,/NO-GO para produção/);
  assert.match(doc,/nove alterações pré-existentes não aplicadas/);
});

test('Wave 7 accepts true public UI at all viewports without exposing business records',()=>{
  assert.match(browser,/const commandPages = \[/);
  assert.match(browser,/label:'Visão operacional',heading:'Centro de operações'/);
  assert.match(browser,/label:'Field Service Cockpit',heading:'Despacho e execução'/);
  assert.match(browser,/getByRole\('region',\{name:'Centro transacional de operações'\}\)/);
  assert.match(browser,/getByRole\('combobox',\{name:'Fila operacional'\}\)/);
  assert.match(browser,/enterprise-operations-indicators button/);
  assert.match(browser,/assert\.equal\(opsApi\.status\(\),403/);
  assert.match(browser,/assert\.equal\(forgedOps\.status\(\),403/);
  assert.match(browser,/HML_WAVE7_PUBLIC/);
  assert.match(browser,/pageWidth\.scroll-pageWidth\.available<=24/);
  assert.match(browser,/unauthenticated-'\+command\.key\+'-'\+profile\.name/);
  assert.match(browser,/await page\.goto\(pageHref,\{waitUntil:'domcontentloaded'/);
  assert.doesNotMatch(browser,/localStorage\.setItem\([^\n]*passphrase/);
});

test('authenticated Tier1 UAT proves 14-stage dossier and correlated audit per owned order',()=>{
 assert.match(browser,/process\.stages\?\.length,14/);
 assert.match(browser,/process\.provenance\?\.ownerScoped,true/);
 assert.match(browser,/process\.provenance\?\.consistency,'repeatable_read'/);
 assert.match(browser,/\/api\/orders\/'\+encodeURIComponent\(orderId\)\+'\/audit\?pageSize=2'/);
 assert.match(browser,/trace\.source,'postgres_owned_event_trace'/);
 assert.match(browser,/invalidAudit\.status\(\),400/);
});

test('finance Tier1 acceptance covers five real modules, three viewports, without private artifacts',()=>{
 const src=read('test/hml-live-acceptance.mjs');
 for(const name of ['Visão financeira','Contas a pagar','Caixa e conciliação','Fiscal e tributos','Fechamentos'])
  assert.ok(src.includes("label:'"+name+"'"),'missing visual UAT for '+name);
 assert.ok(src.includes('HML_FINANCE_TIER1_PUBLIC'));
 assert.ok(src.includes("base.origin+'/api/finance/workspace'"));
 assert.ok(src.includes('publicFinance.status(),403'));
 assert.ok(src.includes("'.app[data-workspace=\"finance\"]'"));
 assert.ok(src.includes('limits.root-limits.viewport<=24'));
 assert.ok(src.includes('unauthenticated-finance-'));
});

test('Tier1 controller staging gate verifies debt aging and source confidentiality on every viewport',()=>{
 const src=read('test/hml-live-acceptance.mjs');
 for(const marker of ['/api/finance/aging?asOf=2026-11-26',
  '/api/finance/cash-flow?from=2026-11-01&to=2026-11-30',
  '/api/accounting/ledger?accountId=00000000',
  "name:'Análise de vencimentos e liquidez documental'",
  "'.finance-tier1-aging-heading'",
  'denied anonymous financial ledger'])
 assert.ok(src.includes(marker),marker);
});
