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
  clients:[],leads:[],assets:[],professionals:[],events:[],documents:[],notes:[],
  accounts:[],journals:[],statements:[],invoices:[],receivables:[],
  purchases:[],movements:[],materials:[],allocations:[],teams:[],
  matches:[],jobs:[],tasks:[],contracts:[],opportunities:[],proposals:[],
  views:[],lines:[],metrics:[],alerts:[],balances:[],pending:[],
  pageInfo, total:0,page,hasMore:false,sourceTotal:0,
  summary:{total:0,drafts:0,planned:0,pendingMeasurements:0,amount:0,
    outstanding:0,received:0,paid:0,balance:0,alerts:0,draft:0,approved:0,
    projectedIn:0,projectedOut:0,realizedIn:0,realizedOut:0,netProjected:0,netRealized:0},
  totals:{leads:0,opportunities:0},
  lanes:[],authority:'SYNTHETIC_LAYOUT_ONLY',sampleLimitPerLane:6,
  limits:{leads:0,opportunities:0},
  measurements:[],relations:[],suppliers:[],inventoryItems:[],
  warnings:[],emptyState:null,openingBankBalanceScaled:'0',
  availableCash:{value:null,reason:'Dados reais não disponíveis na fixture sintética'},
  from:'2026-11-01',to:'2026-11-30',asOf:'2026-11-20',
  aggregates:[],generatedAt:'2026-11-20T12:00:00.000Z',
 };
}
async function openDestination(page:Page,name:string){
 const nav=page.getByRole('navigation',{name:'Módulos empresariais'});
 // At tablet/mobile the sidebar keeps the navigation mounted but off-canvas.
 // Open it explicitly before querying module buttons.
 if((await page.evaluate(()=>window.innerWidth))<=900){
  const menu=page.getByRole('button',{name:'Abrir menu'});
  if(await menu.isVisible()) await menu.click();
 }
 const button=name==='Ordens de serviço'
  ? nav.getByRole('button',{name:/^Ordens de serviço/})
  : nav.getByRole('button',{name,exact:true});
 if(!(await button.isVisible())){
  await button.locator('xpath=ancestor::*[contains(@class,"nav-group")]')
   .locator('.nav-group-toggle').click();
 }
 await button.evaluate((element) => (element as HTMLButtonElement).click());
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
   const syntheticTower={
    ...fakeList(pageNo),authority:'owner_scoped_persisted_postgresql.v1',
    sampleLimitPerLane:6,
    lanes:[
      ['lateOrders','Ordens em atraso','Centro de operações'],
      ['unmeasuredOrders','Concluídas sem medição aprovada','Medições'],
      ['overdueReceivables','Recebíveis vencidos','Financeiro'],
      ['overduePayables','Obrigações vencidas','Contas a pagar'],
      ['latePurchases','Compras não recebidas no prazo','Compras'],
      ['stockShortage','Materiais abaixo do mínimo','Estoque e compras'],
      ['myApprovals','Aprovações atribuídas','Fechamentos'],
    ].map(([id,label,target])=>({id,label,target,count:0,totalAmountScaled:null,
      authority:'SYNTHETIC_LAYOUT_ONLY',items:[]})),
   };
   await route.fulfill({
    status:200,contentType:'application/json',
    headers:{'x-cisne-test-data':'SYNTHETIC_LAYOUT_ONLY','cache-control':'no-store'},
    body:JSON.stringify(url.pathname==='/api/enterprise/control-tower'?syntheticTower:fakeList(pageNo)),
   });
  });
  for(const size of viewports){
   await page.setViewportSize({width:size.width,height:size.height});
   await page.goto('/');
   await openDestination(page,name);
   // Network idle is not an application-ready event (procurement health polling
   // can keep network active); assert a mounted enterprise page and wait for paint.
   const main=page.locator('#cisne-workspace-content');
   await expect(main).toBeVisible();
   await expect.poll(async()=>main.evaluate(el=>(el.textContent??'').trim().length))
    .toBeGreaterThan(8);
   await page.evaluate(()=>new Promise<void>(resolve=>
     requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
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
   if(
      (name==='Frota e ativos'&&size.name==='tablet')||
      (name==='Fiscal e tributos'&&size.name==='tablet')||
      (name==='Contas a pagar'&&size.name==='mobile')||
      (name==='Contabilidade'&&size.name==='mobile')
    ){
      expect(metrics.documentWidth, name+' '+size.name+' page must fit without clipping business fields')
        .toBeLessThanOrEqual(metrics.viewport+2);
    }
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
