// Browser-to-live-HTTP business UAT with an ephemeral signed actor (no UI login).
// Runs exclusively on GitHub Actions with disposable Postgres and fictitious data.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {issueStagingSession,CISNE_STAGING_COOKIE} from '../lib/api/staging-session.mjs';
const fixture=JSON.parse(await readFile('artifacts/rc80-ui/fixture.json','utf8'));
const playwrightPath=process.env.PLAYWRIGHT_MODULE_PATH;
assert.ok(playwrightPath?.startsWith('/'));
if(process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true')throw Error('NO-GO CI only');
const {chromium}=await import(playwrightPath);
const origin='http://localhost:8787';
const token=issueStagingSession(fixture.owner,process.env.CISNE_STAGING_SESSION_SECRET);
const evidence=[];
const chrome=await chromium.launch({headless:true,args:['--no-sandbox']});
const json=async(response)=>{let body=await response.json();return body;};
try{
  for(const viewport of [{name:'desktop',width:1440,height:900},{name:'mobile',width:390,height:844}]){
    const ctx=await chrome.newContext({viewport:{width:viewport.width,height:viewport.height},
      locale:'pt-BR',isMobile:viewport.name==='mobile',hasTouch:viewport.name==='mobile'});
    await ctx.addCookies([{
      name:CISNE_STAGING_COOKIE,value:token,url:origin,
      secure:true,httpOnly:true,sameSite:'Lax',
    }]);
    try{
      const api=await ctx.request.get(origin+'/api/orders');
      assert.equal(api.status(),200,'Signed CI actor must read own OS on '+viewport.name);
      const data=await json(api);
      assert.ok(data.items.some(item=>item.id===fixture.orderId),'Seeded OS missing in API');
      const page=await ctx.newPage();
      const uncaught=[];
      page.on('pageerror',error=>uncaught.push(error.message));
      const pageResponse=await page.goto(origin+'/#Ordens%20de%20servi%C3%A7o',{waitUntil:'domcontentloaded'});
      assert.equal(pageResponse?.status(),200);
      await page.locator('main h1').waitFor({state:'visible',timeout:30000});
      await page.waitForFunction(()=>document.querySelector('main h1')?.textContent?.trim()==='Ordens de serviço');
      await page.getByText(fixture.title,{exact:true}).first().waitFor({state:'visible',timeout:25000});
      await page.screenshot({path:'artifacts/rc80-ui/'+viewport.name+'-owned-os.png',fullPage:true,animations:'disabled'});
      const width=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
      assert.ok(width<=16,'Horizontal overflow: '+viewport.name+' '+width);
      await page.evaluate(()=>{window.location.hash=encodeURIComponent('Financeiro')});
      await page.waitForFunction(()=>document.querySelector('main h1')?.textContent?.trim()==='Financeiro');
      await page.screenshot({path:'artifacts/rc80-ui/'+viewport.name+'-finance-before.png',fullPage:true,animations:'disabled'});
      assert.deepEqual(uncaught,[],'Uncaught JS in '+viewport.name);
      evidence.push({viewport:viewport.name,ownedOsRendered:true,financialWorkspaceRendered:true,jsErrors:0,overflow:Math.max(0,width)});
    }finally{await ctx.close();}
  }
  const ctx=await chrome.newContext();
  await ctx.addCookies([{name:CISNE_STAGING_COOKIE,value:token,url:origin,
    secure:true,httpOnly:true,sameSite:'Lax'}]);
  try{
    const getDetail=async()=>{
      const response=await ctx.request.get(origin+'/api/orders/'+fixture.orderId);
      assert.equal(response.status(),200);
      return (await json(response)).order;
    };
    const initial=await getDetail();
    assert.equal(initial.finance.receivableScaled,'120000');
    assert.equal(initial.finance.settledScaled,'0');
    assert.equal(initial.finance.outstandingScaled,'120000');
    const documentResponse=await ctx.request.get(origin+'/api/orders/'+fixture.orderId+'/documents');
    assert.equal(documentResponse.status(),200);
    const documents=await json(documentResponse);
    assert.equal(documents.enabled,false,'No external NextCRM mapping should leak');
    assert.equal(documents.items.length,0);

    const settlePath='/api/finance/receivables/settlements';
    const receiptKey=randomUUID();
    const receipt={
      receivableId:fixture.receivableId,amount:'25000',effectiveDate:'2026-11-16',
      reference:'RC80 synthetic partial receipt',commandKey:receiptKey,
    };
    const first=await ctx.request.post(origin+settlePath,{data:receipt});
    assert.equal(first.status(),201,JSON.stringify(await json(first)));
    const replay=await ctx.request.post(origin+settlePath,{data:receipt});
    assert.equal(replay.status(),200,'Idempotent HTTP receipt replay');
    const afterReceipt=await getDetail();
    assert.equal(afterReceipt.finance.settledScaled,'25000');
    assert.equal(afterReceipt.finance.outstandingScaled,'95000');
    const reverse=await ctx.request.post(origin+settlePath+'/'+receiptKey+'/reverse',{
      data:{commandKey:randomUUID(),effectiveDate:'2026-11-17',
        reference:'RC80 synthetic reversal'}});
    assert.equal(reverse.status(),201,JSON.stringify(await json(reverse)));
    const afterReversal=await getDetail();
    assert.equal(afterReversal.finance.settledScaled,'0');
    assert.equal(afterReversal.finance.outstandingScaled,'120000');
    const period=await ctx.request.post(origin+'/api/finance/periods/close',{data:{
      id:randomUUID(),periodStart:'2026-11-01',periodEnd:'2026-11-30',
      reference:'RC80 synthetic finance close',
    }});
    assert.equal(period.status(),201,JSON.stringify(await json(period)));
    const denied=await ctx.request.post(origin+settlePath,{data:{
      ...receipt,commandKey:randomUUID(),reference:'RC80 closed-period denial',
    }});
    assert.equal(denied.status(),409,'Closed period must block retroactive receipt');
    evidence.push({businessChain:'OS->measurement->invoice->receivable->receipt->reversal->close',
      sameOrder:fixture.orderId,principalScaled:'120000',receiptScaled:'25000',
      afterReceiptOutstandingScaled:'95000',afterReversalOutstandingScaled:'120000',
      receiptReplayStatus:200,closedPeriodWriteDeniedStatus:409,
      nextcrmDocuments:'not_mapped_fail_closed'});
    const publicCtx=await chrome.newContext();
    try{
      const anonymous=await publicCtx.request.get(origin+'/api/orders');
      assert.equal(anonymous.status(),403,'Anonymous may not read synthetic data');
      const spoof=await publicCtx.request.get(origin+'/api/orders',{
        headers:{'oai-authenticated-user-id':fixture.owner}});
      assert.equal(spoof.status(),403,'Forged public owner header must fail');
      const noCookiePost=await publicCtx.request.post(origin+settlePath,{data:receipt});
      assert.equal(noCookiePost.status(),403,'Anonymous mutation rejected');
      evidence.push({unauthorizedRead:403,forgedHeaderRead:403,unauthorizedWrite:403});
    }finally{await publicCtx.close();}
  }finally{await ctx.close();}
  console.log('RC80_REAL_HTTP_SYNTHETIC_BUSINESS_BROWSER_UAT_SUCCESS');
}finally{
  await writeFile('artifacts/rc80-ui/evidence.json',JSON.stringify({
    runSha:process.env.GITHUB_SHA??null,origin:'loopback-only',
    database:'ephemeral CI PostgreSQL',nextcrm:'NO REAL NEXTCRM DOCUMENT IN THIS RUN',
    evidence,
  },null,2));
  await chrome.close();
}
