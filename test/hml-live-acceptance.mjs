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

      // Anonymous access must be denied; the persisted tenant list is tested only after login.
      const unauthorizedTenants = await context.request.get(base.origin+'/api/enterprise/tenants',time);
      assert.equal(unauthorizedTenants.status(),403,profile.name+' deny anonymous tenant list');
      const externalRouteUnauth=await context.request.get(base.origin+'/api/enterprise/tenants/00000000-0000-4000-8000-000000000000/external-references',time);
      assert.equal(externalRouteUnauth.status(),403,profile.name+' reference registry denies anonymous access');
      const externalRouteForged=await context.request.get(base.origin+'/api/enterprise/tenants/00000000-0000-4000-8000-000000000000/external-references',{
        ...time,headers:{'oai-authenticated-user-id':'forged-actor','x-cisne-dispatch-secret':'forged'},
      });
      assert.equal(externalRouteForged.status(),403,profile.name+' reference registry denies forged identity');
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
        if(live)assert.equal(live.status(),200,profile.name+' '+command.key+' shell response');
        await page.getByRole('heading',{name:command.heading,exact:true})
          .waitFor({state:'visible',...time});
        await page.getByRole('region',{name:'Centro transacional de operações'})
          .waitFor({state:'visible',...time});
        const indicators = await page.locator('.enterprise-operations-indicators button').count();
        assert.equal(indicators,5,profile.name+' '+command.key+' factual work queue shortcuts');
        // Tier 1 workstation: verify the three genuine work surfaces, not just HTML markers.
        if(command.key==='operations'){
          const tabs=page.getByRole('tablist',{name:'Espaços da estação de trabalho'});
          await tabs.waitFor({state:'visible',...time});
          const work=page.getByRole('tab',{name:'Trabalho',exact:true});
          const analysis=page.getByRole('tab',{name:'Análise operacional',exact:true});
          const finance=page.getByRole('tab',{name:'Controladoria',exact:true});
          assert.equal(await analysis.getAttribute('aria-selected'),'true');
          await analysis.click();
          await page.getByRole('heading',{name:'OS por situação',exact:true}).waitFor({state:'visible',...time});
          assert.equal(await analysis.getAttribute('aria-selected'),'true');
          await finance.click();
          await page.getByRole('region',{name:'Integração financeira e contábil'})
            .waitFor({state:'visible',...time});
          assert.equal(await finance.getAttribute('aria-selected'),'true');
          await work.click();
          await page.getByRole('region',{name:'Sinais de integridade contábil'})
            .waitFor({state:'visible',...time});
          assert.equal(await work.getAttribute('aria-selected'),'true');
          const forbiddenAccounting=await context.request.get(
            base.origin+'/api/accounting/reconciliation',time);
          assert.equal(forbiddenAccounting.status(),403,profile.name+' anonymous accounting denied');
        }
        // Queue controls are in the Trabalho surface, not the default analytical tab.
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
      // Tier 1 finance public acceptance is strictly READ-ONLY. The UI must
      // render before sign-in without leaking financial records or creating fixtures.
      const publicFinance=await context.request.get(
        base.origin+'/api/finance/workspace',time);
      assert.equal(publicFinance.status(),403,profile.name+' anonymous finance scope denied');
      // Tier 1 read-only expansion: portfolio and books must stay denied
      // before an authenticated staging session exists.
      for(const route of [
        '/api/finance/aging?asOf=2026-11-26',
        '/api/finance/cash-flow?from=2026-11-01&to=2026-11-30',
        '/api/accounting/ledger?accountId=00000000-0000-4000-8000-000000000000',
      ]){
        const response=await context.request.get(base.origin+route,time);
        assert.equal(response.status(),403,profile.name+' denied anonymous financial ledger '+route);
      }
      const financePages=[
        {label:'Visão financeira',heading:'Visão financeira'},
        {label:'Contas a pagar',heading:'Contas a pagar'},
        {label:'Caixa e conciliação',heading:'Caixa e conciliação'},
        {label:'Fiscal e tributos',heading:'Fiscal manual'},
        {label:'Fechamentos',heading:'Fechamento financeiro'},
      ];
      for(const finance of financePages){
        const live=await page.goto(base.origin+'/#'+encodeURIComponent(finance.label),
          {waitUntil:'domcontentloaded',...time});
        if(live)assert.equal(live.status(),200,profile.name+' '+finance.label+' shell');
        await page.getByRole('heading',{name:finance.heading,exact:true}).first()
          .waitFor({state:'visible',...time});
        await page.locator('.app[data-workspace="finance"]')
          .waitFor({state:'visible',...time});
        // Overflow is confined to an internal table, never the entire app.
        const limits=await page.evaluate(()=>({
          viewport:document.documentElement.clientWidth,
          root:document.documentElement.scrollWidth,
        }));
        assert.ok(limits.root-limits.viewport<=24,
          profile.name+' '+finance.label+' unexpected page-width overflow');
        if(finance.label==='Visão financeira'){
          await page.getByRole('region',{name:'Filas de exceção e encaminhamento'})
            .waitFor({state:'visible',...time});
          await page.getByRole('region',{name:'Análise de vencimentos e liquidez documental'})
            .waitFor({state:'visible',...time});
          await page.locator('.finance-tier1-aging-heading')
            .waitFor({state:'visible',...time});
          await page.screenshot({
            path:join(artifactDir,'unauthenticated-finance-'+profile.name+'.png'),
            fullPage:false,
          });
        }
        if(finance.label==='Fechamentos')
          assert.equal(await page.getByRole('button',{name:'Fechar período'}).isVisible(),true);
        console.log('HML_FINANCE_TIER1_PUBLIC '+JSON.stringify({
          module:finance.label,profile:profile.name,
          heading:'PASS',scopedLayout:'PASS',anonymousApi:'DENIED',
          rootOverflowPx:Math.max(0,limits.root-limits.viewport),
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
      // Authenticated tenant and legal-entity reads use the same verified session.
      const legalEntitiesApi=await context.request.get(base.origin+'/api/enterprise/tenants',time);
      assert.equal(legalEntitiesApi.status(),200,profile.name+' authenticated tenant list');
      const tenantRows=(await legalEntitiesApi.json()).items;
      assert.ok(Array.isArray(tenantRows),'tenant list must be persisted and scoped');
      for(const tenant of tenantRows.slice(0,5)){
        const entities=await context.request.get(base.origin+'/api/enterprise/tenants/'+encodeURIComponent(tenant.id)+'/legal-entities',time);
        assert.equal(entities.status(),200,profile.name+' tenant legal entities scoped');
        const references=await context.request.get(base.origin+'/api/enterprise/tenants/'+encodeURIComponent(tenant.id)+'/external-references',time);
        assert.equal(references.status(),200,profile.name+' tenant external references scoped');
        assert.ok(Array.isArray((await references.json()).items),'external reference registry must return persisted items');
      }

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
      // Authenticated, READ-ONLY acceptance of the new worklist layout and object inspector.
      const scopedOrders=await context.request.get(
        base.origin+'/api/enterprise/operations?queue=all&page=1&pageSize=5',time);
      assert.equal(scopedOrders.status(),200,profile.name+' owner-scoped worklist API');
      const scoped=await scopedOrders.json();
      assert.equal(scoped.source,'postgres_owner_scoped_operations');
      assert.ok(Array.isArray(scoped.items),'worklist returns persisted, authorized records');
      // Integration gate: the same authorized OS must resolve to a verified
      // 14-stage dossier and an owner-scoped, append-only timeline.
      if(scoped.items.length){
        const orderId=scoped.items[0].id;
        const dossierResponse=await context.request.get(
          base.origin+'/api/enterprise/journeys/'+encodeURIComponent(orderId),time);
        assert.equal(dossierResponse.status(),200,profile.name+' persisted process dossier');
        const process=await dossierResponse.json();
        assert.equal(process.order?.id,orderId);
        assert.equal(process.provenance?.ownerScoped,true);
        assert.equal(process.provenance?.consistency,'repeatable_read');
        assert.equal(process.stages?.length,14);
        const auditResponse=await context.request.get(
          base.origin+'/api/orders/'+encodeURIComponent(orderId)+'/audit?pageSize=2',time);
        assert.equal(auditResponse.status(),200,profile.name+' owned operational timeline');
        const trace=await auditResponse.json();
        assert.equal(trace.orderId,orderId);
        assert.equal(trace.source,'postgres_owned_event_trace');
        assert.ok(Array.isArray(trace.items));
        assert.ok(trace.items.every(item=>typeof item.command==='string'));
        const invalidAudit=await context.request.get(
          base.origin+'/api/orders/invalid/audit',time);
        assert.equal(invalidAudit.status(),400,profile.name+' invalid audit path rejected');
      }
      await page.goto(base.origin+'/#'+encodeURIComponent('Visão operacional'),
        {waitUntil:'domcontentloaded',...time});
      await page.getByRole('tab',{name:'Trabalho',exact:true})
        .waitFor({state:'visible',...time});
      await page.getByRole('tab',{name:'Trabalho',exact:true}).click();
      await page.getByRole('combobox',{name:'Fila operacional'}).selectOption('all');
      if(scoped.items.length){
        if(profile.width<=800){
          const first=page.locator('.cisne-workstation-mobile-order').first();
          await first.waitFor({state:'visible',...time});
          await first.click();
          const dialog=page.getByRole('dialog',{name:'Object Page da ordem selecionada'});
          await dialog.waitFor({state:'visible',...time});
          await page.getByRole('button',{name:'Fechar inspeção'}).click();
          await dialog.waitFor({state:'hidden',...time});
        }else{
          const first=page.locator('.enterprise-smart-open').first();
          await first.waitFor({state:'visible',...time});
          await first.click();
          assert.equal(await page.locator('.enterprise-operations-object').isVisible(),true);
          await page.getByRole('button',{name:'Ocultar inspeção'}).click();
          await page.getByRole('button',{name:'Mostrar inspeção'}).click();
          assert.equal(await page.locator('.enterprise-operations-object').isVisible(),true);
        }
      }
      const workstationOverflow=await page.evaluate(()=>({
        available:document.documentElement.clientWidth,
        scroll:document.documentElement.scrollWidth,
      }));
      assert.ok(workstationOverflow.scroll-workstationOverflow.available<=24,
        profile.name+' Tier 1 workstation unexpected horizontal overflow');
      console.log('HML_TIER1_WORKSTATION '+JSON.stringify({
        profile:profile.name,tabs:'PASS',protectedLedger:'PASS',
        authenticatedList:'PASS',inspector:scoped.items.length?'PASS':'NO_RECORDS',
        rootOverflowPx:Math.max(0,workstationOverflow.scroll-workstationOverflow.available),
      }));
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
