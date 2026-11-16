// RC78 anonymous-only Chromium acceptance; never supplies privileged credentials or valid writes.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const origin='https://cisne-rc79-readonly-uat-candidate-staging.up.railway.app';
const root='artifacts/rc78-browser';
const screens=[{name:'desktop',width:1440,height:900,mobile:false},{name:'mobile',width:390,height:844,mobile:true}];
const modules=['Visão operacional','Ordens de serviço','Medições','Faturamento','Financeiro','Fechamentos'];
const guards=[
  ['GET','/api/orders','STAGING_PRIVATE_ACCESS_REQUIRED'],
  ['GET','/api/finance/workspace','STAGING_PRIVATE_ACCESS_REQUIRED'],
  ['GET','/api/operation?kind=receivables','STAGING_PRIVATE_ACCESS_REQUIRED'],
  ['POST','/api/orders','STAGING_READ_ONLY_PREVIEW'],
  ['POST','/api/commands','STAGING_READ_ONLY_PREVIEW'],
  ['POST','/api/finance/receivables/settlements','STAGING_READ_ONLY_PREVIEW'],
];
const modulePath=process.env.PLAYWRIGHT_MODULE_PATH;
assert.ok(modulePath?.startsWith('/'),'Use matching Playwright absolute section path');
const {chromium}=await import(modulePath);
await mkdir(root,{recursive:true});
const browser=await chromium.launch({args:['--no-sandbox']});
const findings=[];
try {
  for(const device of screens){
    const context=await browser.newContext({
      viewport:{width:device.width,height:device.height},isMobile:device.mobile,
      hasTouch:device.mobile,locale:'pt-BR',reducedMotion:'reduce',
    });
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message.slice(0,180)));
    try{
      const response=await page.goto(origin+'/',{waitUntil:'domcontentloaded',timeout:30000});
      assert.equal(response?.status(),200,'UI HTTP 200 '+device.name);
      assert.match(await page.title(),/Cisne/i);
      await page.locator('main h1').waitFor({state:'visible',timeout:25000});
      for(const section of modules){
        await page.evaluate(x=>{window.location.hash=encodeURIComponent(x)},section);
        await page.waitForFunction(x=>document.querySelector('main h1')?.textContent?.trim()===x,section,{timeout:15000});
        const active=page.locator('nav[aria-label="Módulos empresariais"] button[aria-current="page"]');
        assert.equal(await active.count(),1,'one active section '+section);
        assert.equal((await active.locator('span').first().innerText()).trim(),section);
        const key=section.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-');
        await page.screenshot({path:join(root,device.name+'-'+key+'.png'),fullPage:true,animations:'disabled'});
        const width=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
        assert.ok(width<=16,'horizontal overflow '+device.name+'/'+section+': '+width+'px');
        findings.push({device:device.name,section,overflow:Math.max(0,width)});
      }
      await page.getByRole('button',{name:/Buscar no Cisne/}).click();
      await page.getByRole('dialog',{name:'Busca global'}).waitFor({state:'visible'});
      await page.keyboard.press('Escape');
      await page.getByRole('dialog',{name:'Busca global'}).waitFor({state:'hidden'});
      assert.deepEqual(errors,[],'Uncaught JS '+device.name);
      findings.push({device:device.name,search:'open+Escape',jsErrors:errors.length});
    }finally{await context.close()}
  }
  const ctx=await browser.newContext();
  try{
    const ready=await ctx.request.get(origin+'/api/health/ready');
    assert.equal(ready.status(),200);
    assert.equal((await ready.json()).status,'ready');
    findings.push({endpoint:'readiness',status:200});
    for(const [method,path,expected] of guards){
      const opts={headers:method==='POST'?{origin,'content-type':'application/json'}:{},data:{}};
      const response=method==='GET'?await ctx.request.get(origin+path):await ctx.request.post(origin+path,opts);
      assert.equal(response.status(),403,method+' '+path);
      assert.equal((await response.json()).code,expected);
      assert.match(response.headers()['cache-control']??'',/no-store/);
      findings.push({method,path,status:403,code:expected});
    }
    const forged=await ctx.request.get(origin+'/api/orders',{headers:{'oai-authenticated-user-id':'untrusted'}});
    assert.equal(forged.status(),403);
    assert.equal((await forged.json()).code,'STAGING_PRIVATE_ACCESS_REQUIRED');
    findings.push({method:'GET',path:'/api/orders',forgedHeader:true,status:403});
  }finally{await ctx.close()}
  console.log('PASS: 12 rendered screens, search, 8 public API probes');
}finally{
  await writeFile(join(root,'evidence.json'),JSON.stringify({origin,runSha:process.env.GITHUB_SHA??null,
    scope:'anonymous UI and readonly HTTP, NOT authenticated/real NextCRM writes',findings},null,2));
  await browser.close();
}