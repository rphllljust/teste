#!/usr/bin/env node
/**
 * Read-only browser/ACL acceptance against the EXISTING Railway Staging site.
 * Chromium is installed only on the GitHub runner; no Railway services or
 * business fixtures are created. Screenshots are taken BEFORE login only.
 * Never log passphrases, cookies, document contents, actor identifiers or PII.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const base = new URL(process.env.CISNE_HML_BASE_URL ||
  'https://cisne-web-staging-staging.up.railway.app');
if (base.origin !== 'https://cisne-web-staging-staging.up.railway.app' ||
    base.username || base.password || base.search || base.hash)
  throw new Error('HML_TARGET_INVALID: only the fixed CISNE Staging HTTPS origin is allowed');

const secret = process.env.CISNE_HML_LOGIN_PASSPHRASE || '';
const requireAuth = process.env.CISNE_HML_REQUIRE_AUTH === '1';
const artifactDir = process.env.CISNE_HML_ARTIFACT_DIR || 'test-results/hml-public';
const profiles = [
  { name:'desktop', width:1440, height:900 },
  { name:'tablet', width:768, height:1024 },
  { name:'mobile', width:390, height:844 },
];
const time = { timeout: 30_000 };
const results = [];
const publicApi = '/api/enterprise/journeys?page=1&pageSize=5';
const pageHref = base.origin + '/#' + encodeURIComponent('Dossiês empresariais');

await mkdir(artifactDir,{ recursive:true });
const browser = await chromium.launch({ headless:true });
try {
  for (const profile of profiles) {
    const context = await browser.newContext({
      viewport:{width:profile.width,height:profile.height},
      locale:'pt-BR', serviceWorkers:'block',
    });
    const page = await context.newPage();
    const uncaught = [];
    page.on('pageerror', error => uncaught.push(error.message.slice(0,300)));
    try {
      const landing = await page.goto(pageHref, { waitUntil:'domcontentloaded', ...time });
      assert.equal(landing?.status(),200,profile.name+' shell HTTP');
      await page.getByRole('heading',{name:'Dossiês empresariais',exact:true})
        .waitFor({state:'visible',...time});
      // The HML operator must be able to log in directly from this module.
      // Do not fill, screenshot after authentication or log the passphrase.
      await page.locator('.enterprise-dossier-auth input[name="passphrase"][type="password"]')
        .waitFor({state:'visible',timeout:15_000});
      assert.equal(await page.getByRole('button',{name:'Entrar nos Dossiês',exact:true}).isVisible(),
        true, profile.name+' direct signed-session form');
      const region = page.getByRole('region',{name:'Tabela de processos empresariais'});
      // Unauthenticated shell may display the API access-denied state instead of a table.
      assert.ok((await page.locator('body').innerText()).includes('Dossiês empresariais'),
        profile.name+' expected an actual dossier workspace, not a missing route');
      const unauth = await context.request.get(base.origin + publicApi, time);
      assert.equal(unauth.status(),403,profile.name+' deny anonymous dossier list');
      const unauthorizedBody = await unauth.json();
      assert.ok(!Array.isArray(unauthorizedBody?.items),
        'anonymous user must not receive enterprise documents');
      const impersonated = await context.request.get(base.origin + publicApi,{
        ...time,headers:{'oai-authenticated-user-id':'forged-actor','x-cisne-dispatch-secret':'forged'},
      });
      assert.equal(impersonated.status(),403,profile.name+' deny forged browser identity');
      const unauthorizedDetail = await context.request.get(
        base.origin + '/api/enterprise/journeys/00000000-0000-4000-8000-000000000000',time);
      assert.equal(unauthorizedDetail.status(),403,profile.name+' deny anonymous dossier detail');

      // Capture ONLY the public, unauthenticated view: never export business data.
      await page.screenshot({path:join(artifactDir,'unauthenticated-'+profile.name+'.png'),fullPage:false});
      const viewport = await page.evaluate(() => ({
        viewport:window.innerWidth,
        rootScroll:document.documentElement.scrollWidth,
      }));
      const overflow = viewport.rootScroll - viewport.viewport;
      if (overflow > 24) {
        console.warn('HML_VIEWPORT_WARNING '+profile.name+' root overflow '+overflow+'px');
      }

      // Wave 7 release UAT: verify the two NEW document-first command workspaces
      // on the LIVE Railway deployment, without session or business fixtures.
      const opsApi = await context.request.get(base.origin +
        '/api/enterprise/operations?queue=attention&page=1&pageSize=5',time);
      assert.equal(opsApi.status(),403,profile.name+' deny anonymous owner-scoped command center');
      const forgedOps = await context.request.get(base.origin +
        '/api/enterprise/operations?queue=all',{
        ...time,headers:{'oai-authenticated-user-id':'forged-actor','x-cisne-dispatch-secret':'forged'},
      });
      assert.equal(forgedOps.status(),403,profile.name+' deny forged command-center actor');
      const commandPages = [
        {label:'Visão operacional',heading:'Centro de operações',key:'operations'},
        {label:'Field Service Cockpit',heading:'Despacho e execução',key:'field'},
      ];
      for (const command of commandPages) {
        const target = base.origin + '/#' + encodeURIComponent(command.label);
        const live = await page.goto(target,{waitUntil:'domcontentloaded',...time});
        assert.equal(live?.status(),200,profile.name+' '+command.key+' shell response');
        await page.getByRole('heading',{name:command.heading,exact:true})
          .waitFor({state:'visible',...time});
        await page.getByRole('region',{name:'Centro transacional de operações'})
          .waitFor({state:'visible',...time});
        const indicators = await page.locator('.enterprise-operations-indicators button').count();
        assert.equal(indicators,5,profile.name+' '+command.key+' factual work queue shortcuts');
        assert.equal(await page.getByRole('combobox',{name:'Fila operacional'}).isVisible(),true);
        await page.screenshot({
          path:join(artifactDir,'unauthenticated-'+command.key+'-'+profile.name+'.png'),
          fullPage:false,
        });
        const pageWidth=await page.evaluate(()=>({
          available:document.documentElement.clientWidth,
          scroll:document.documentElement.scrollWidth,
        }));
        assert.ok(pageWidth.scroll-pageWidth.available<=24,
          profile.name+' '+command.key+' unexpected root horizontal overflow');
        console.log('HML_WAVE7_PUBLIC '+JSON.stringify({
          screen:command.key,profile:profile.name,heading:'PASS',indicators,
          rootOverflowPx:Math.max(0,pageWidth.scroll-pageWidth.available),
          anonymousApi:'DENIED',
        }));
      }
      // Return to the dossier before optional signed-session acceptance.
      await page.goto(pageHref,{waitUntil:'domcontentloaded',...time});

      if (!secret) {
        results.push({profile:profile.name,public:'PASS',authenticated:'NOT_RUN',records:'NOT_RUN',
          navigation:'PASS',horizontalOverflowPx:Math.max(0,overflow)});
        continue;
      }
      assert.ok(secret.length>=24 && secret.length<=160,'HML secret has invalid length');
      const login = await context.request.post(base.origin + '/api/auth/staging-login',{
        ...time,headers:{ origin:base.origin,'content-type':'application/json' },
        data:{passphrase:secret},
      });
      // Do not print request/response bodies or session cookie under any circumstances.
      assert.equal(login.status(),200,profile.name+' authenticated HML session');
      const auth = await context.request.get(base.origin + '/api/auth/staging-login',time);
      assert.equal(auth.status(),200);
      assert.equal((await auth.json()).authenticated,true,'server must verify HML session');

      const list = await context.request.get(base.origin + publicApi,time);
      assert.equal(list.status(),200,profile.name+' actor-scoped dossier list');
      const data = await list.json();
      assert.ok(Array.isArray(data.items) && Number.isInteger(data.pageInfo?.total),
        'authenticated list must be a real paginated database response');
      assert.equal(data.source,'postgres_owned_service_orders');
      await page.reload({waitUntil:'domcontentloaded',...time});
      await page.getByRole('heading',{name:'Dossiês empresariais',exact:true})
        .waitFor({state:'visible',...time});
      await region.waitFor({state:data.items.length?'visible':'detached',timeout:15_000}).catch(async()=>{
        // A valid empty result is rendered as an explicit business state.
        if(data.items.length) throw new Error('Authenticated dossier table never rendered');
      });

      let recordTest = 'NO_RECORDS';
      if(data.items.length){
        const record = data.items[0];
        // Test is strictly GET: it never alters real or fictitious business data.
        const detail = await context.request.get(base.origin +
          '/api/enterprise/journeys/'+encodeURIComponent(record.id),time);
        assert.equal(detail.status(),200,'read persisted document for authorized actor');
        const dossier = await detail.json();
        assert.equal(dossier.order?.id,record.id);
        assert.equal(dossier.provenance?.ownerScoped,true);
        assert.equal(dossier.provenance?.consistency,'repeatable_read');
        assert.equal(dossier.stages?.length,14);
        assert.match(dossier.financials?.billedScaled||'',/^-?\d+$/);
        assert.match(dossier.financials?.settledScaled||'',/^-?\d+$/);
        recordTest = 'PASS';
      }
      results.push({profile:profile.name,public:'PASS',authenticated:'PASS',
        records:recordTest,navigation:'PASS',horizontalOverflowPx:Math.max(0,overflow)});
      assert.deepEqual(uncaught,[],profile.name+' unhandled page errors');
    }finally{
      await context.close();
    }
  }

  if(!secret){
    console.log('HML_AUTHENTICATED_NOT_EXECUTED: no ephemeral/protected login passphrase provided');
    if(requireAuth)throw new Error('NO_GO: authenticated HML evidence is mandatory but secret is unavailable');
  }
  for(const outcome of results) console.log('HML_ACCEPTANCE '+JSON.stringify(outcome));
  const full = results.every(r=>r.authenticated==='PASS'&&r.records==='PASS');
  console.log('HML_ACCEPTANCE_VERDICT '+(full?'AUTHENTICATED_READ_ONLY_PASS':
    'PARTIAL_PUBLIC_ONLY_OR_NO_DATABASE_FIXTURE'));
  if(requireAuth&&!full)
    throw new Error('NO_GO: full authenticated read-only business dossier evidence incomplete');
}finally{
  await browser.close();
}
