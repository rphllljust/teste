import {expect,test,type Page} from '@playwright/test';
import {writeFile} from 'node:fs/promises';

// Explicitly SYNTHETIC and never an authenticated/persisted business acceptance.
// Production is not called; every local /api/GET is intercepted with empty fixture data.
const destinations=[
 'Visão operacional','Centro de operações','Field Service Cockpit',
 'Resource Planning Board','Ordens de serviço','Execução','Medições',
 'Clientes e propostas','Propostas e PO','Contratos','Frota e ativos',
 'Profissionais','CRM e Vendas','Faturamento','Visão financeira','Financeiro',
 'Fluxo de caixa','Tesouraria','Contas a pagar','Caixa e conciliação',
 'Fiscal e tributos','Contabilidade','Razão contábil','Fechamentos',
 'Compras','Estoque e compras',
] as const;
const viewports=[
 {name:'desktop',width:1440,height:900},
 {name:'tablet',width:834,height:1112},
 {name:'mobile',width:390,height:844},
] as const;

function fakeList(page:number){
 const pageInfo={page,limit:25,total:0,sourceTotal:0,hasMore:false};
 return {
  items:[],orders:[],records:[],entries:[],rows:[],results:[],transactions:[],
  clients:[],assets:[],professionals:[],events:[],documents:[],notes:[],
  accounts:[],journals:[],statements:[],invoices:[],receivables:[],
  purchases:[],movements:[],materials:[],allocations:[],teams:[],
  matches:[],jobs:[],tasks:[],contracts:[],opportunities:[],proposals:[],
  views:[],lines:[],metrics:[],alerts:[],balances:[],pending:[],
  pageInfo, total:0,page,hasMore:false,sourceTotal:0,
  summary:{total:0,drafts:0,planned:0,pendingMeasurements:0,amount:0,
    outstanding:0,received:0,paid:0,balance:0,alerts:0},
  aggregates:[],generatedAt:'2026-11-20T12:00:00.000Z',
 };
}
async function openDestination(page:Page,name:string){
 const nav=page.getByRole('navigation',{name:'Módulos empresariais'});
 if(!(await nav.isVisible()))await page.getByRole('button',{name:'Abrir menu'}).click();
 const button=nav.getByRole('button',{name,exact:true});
 if(!(await button.isVisible())){
  await button.locator('xpath=ancestor::*[contains(@class,"nav-group")]')
   .locator('.nav-group-toggle').click();
 }
 await button.click();
 await expect(page.locator('.topbar [aria-current="page"]')).toHaveText(name);
 await expect(page.locator('#cisne-workspace-content')).toBeVisible();
}
for(const name of destinations){
 test('[SYNTHETIC layout — NOT authenticated evidence] '+name,async({page})=>{
  test.setTimeout(90000);
  const unexpectedWrites:string[]=[];
  const pageErrors:string[]=[];
  const snapshots:object[]=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.route('**/api/**',async route=>{
   const request=route.request();
   if(request.method()!=='GET'){
     unexpectedWrites.push(request.method()+' '+new URL(request.url()).pathname);
     await route.abort('blockedbyclient');
     return;
   }
   const url=new URL(request.url());
   const pageNo=Number(url.searchParams.get('page'))||1;
   await route.fulfill({
    status:200,contentType:'application/json',
    headers:{'x-cisne-test-data':'SYNTHETIC_LAYOUT_ONLY','cache-control':'no-store'},
    body:JSON.stringify(fakeList(pageNo)),
   });
  });
  for(const size of viewports){
   await page.setViewportSize({width:size.width,height:size.height});
   await page.goto('/');
   await openDestination(page,name);
   await page.waitForLoadState('networkidle',{timeout:10000});
   const metrics=await page.evaluate(()=>({
     viewport:window.innerWidth,
     documentWidth:document.documentElement.scrollWidth,
     mainWidth:document.querySelector('#cisne-workspace-content')?.clientWidth??0,
     mainTextLength:(document.querySelector('#cisne-workspace-content')?.textContent??'').trim().length,
   }));
   expect(metrics.mainWidth).toBeGreaterThan(0);
   expect(metrics.mainTextLength).toBeGreaterThan(8);
   const id=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
     .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
   await page.screenshot({
     path:test.info().outputPath('SYNTHETIC-'+id+'-'+size.name+'.png'),
     fullPage:true,
   });
   snapshots.push({workspace:name,breakpoint:size.name,...metrics,
    horizontalOverflowPx:Math.max(0,metrics.documentWidth-metrics.viewport)});
  }
  const slug=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
     .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  await writeFile(test.info().outputPath('SYNTHETIC-'+slug+'-audit.json'),
   JSON.stringify({evidenceClass:'SYNTHETIC_MOCK_VISUAL_ONLY',
    authenticated:false,persistedDataVerified:false,sha:process.env.GITHUB_SHA??null,
    workspace:name,snapshots,pageErrors,unexpectedWrites},null,2));
  expect(unexpectedWrites,'SYNTHETIC layout tests must never mutate backend').toEqual([]);
  expect(pageErrors,'Runtime error in synthetic workspace navigation').toEqual([]);
 });
}

test('[SYNTHETIC layout] Inventory and MRP are two independent tabs',async({page})=>{
 await page.route('**/api/**',route=>route.fulfill({json:fakeList(1)}));
 await page.goto('/');
 await openDestination(page,'Estoque e compras');
 for(const name of ['Estoque e materiais','Planejamento MRP']){
  await page.getByRole('tab',{name}).click();
  await expect(page.getByRole('tabpanel',{name})).toBeVisible();
  await page.screenshot({path:test.info().outputPath('SYNTHETIC-'+
   (name==='Estoque e materiais'?'inventory':'mrp')+'-desktop.png'),fullPage:true});
 }
});
