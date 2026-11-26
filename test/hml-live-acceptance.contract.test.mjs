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
