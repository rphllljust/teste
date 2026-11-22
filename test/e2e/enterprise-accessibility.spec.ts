import { expect, test } from '@playwright/test';

test('CISNE exposes one main landmark when navigating specialized Field and resource pages',async({page})=>{
 await page.goto('/');
 const main=page.getByRole('main');
 await expect(main).toHaveCount(1);
 await expect(main).toHaveAttribute('id','cisne-workspace-content');
 for(const name of ['Field Service Cockpit','Resource Planning Board']){
   await page.getByRole('navigation',{name:'Módulos empresariais'})
     .getByRole('button',{name,exact:true}).click();
   await expect(main).toHaveCount(1);
   await expect(main).toBeVisible();
   await expect(page.getByRole('region',{name:name==='Field Service Cockpit'?'Cockpit de Field Service':'Resource Planning Board',exact:true})).toBeVisible();
 }
});

test('skip link lands in the enterprise workspace and preserves keyboard focus',async({page})=>{
 await page.goto('/');
 await page.keyboard.press('Tab');
 const skip=page.getByRole('link',{name:'Ir para conteúdo principal'});
 await expect(skip).toBeFocused();
 await page.keyboard.press('Enter');
 await expect(page).toHaveURL(/#cisne-workspace-content$/);
 await expect(page.locator('#cisne-workspace-content')).toBeVisible();
});

test('client Object Page keeps one main landmark and functional Fiori anchors',async({page})=>{
 const client={id:'client-object-a11y',legalName:'Cliente verificado',
  tradeName:'Unidade de teste',document:'00112233000144',email:'teste@example.invalid',
  phone:null,state:{code:'active',label:'Ativo',rowVersion:1},availableCommands:[]};
 await page.route('**/api/clients?*',route=>route.fulfill({json:{
  items:[client],pageInfo:{total:1,sourceTotal:1,hasMore:false},
 }}));
 await page.route('**/api/clients/client-object-a11y/nextcrm',route=>route.fulfill({
  json:{mapped:false,state:'not_configured',message:'Não configurado na fixture'},
 }));
 await page.route('**/api/clients/client-object-a11y',route=>route.fulfill({json:{
  projection:{...client,related:{orders:{total:0},proposals:[],contracts:[]},
   history:[{command:'register',createdAt:'2026-11-20T10:00:00.000Z'}],warnings:[]},
 }}));
 await page.goto('/');
 await page.getByRole('button',{name:'Clientes e propostas'}).click();
 await page.getByRole('grid',{name:'Lista de clientes'})
  .getByRole('button',{name:'Cliente verificado'}).click();
 const object=page.getByRole('region',{name:'Cliente Cliente verificado'});
 await expect(object).toBeVisible();
 await expect(page.getByRole('main')).toHaveCount(1);
 const nav=object.getByRole('navigation',{name:'Seções do objeto'});
 const workspaceHash=await page.evaluate(()=>window.location.hash);
 await nav.getByRole('link',{name:'Histórico'}).click();
 await expect(nav.getByRole('link',{name:'Histórico'})).toHaveAttribute('aria-current','location');
 // The application owns the hash for workspace routing: Fiori section links
 // scroll and focus within the Object Page without leaving the client module.
 expect(await page.evaluate(()=>window.location.hash)).toBe(workspaceHash);
 await expect(object.locator('#client-history')).toBeFocused();
 await expect(object.getByRole('button',{name:'Ativar cliente'})).toHaveCount(0);
 await expect(object.getByRole('button',{name:'Desativar cliente'})).toHaveCount(0);
 await page.setViewportSize({width:390,height:844});
 const toggle=object.getByRole('button',{name:/Seções do registro/});
 await toggle.click();
 await expect(toggle).toHaveAttribute('aria-expanded','true');
 await expect(nav.getByRole('link',{name:'Comercial'})).toBeVisible();
});
