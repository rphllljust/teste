import { expect, test, type Page } from '@playwright/test';

const origin='https://cisne-web-staging-staging.up.railway.app';
const passphrase=process.env.CISNE_STAGING_PASSPHRASE;
const expectedSha=process.env.CISNE_EXPECTED_STAGING_SHA;
if(process.env.CISNE_AUTHENTICATED_E2E!=='1'||process.env.CISNE_BASE_URL!==origin||
   !passphrase||passphrase.length<24||!expectedSha||!/^[a-f0-9]{40}$/.test(expectedSha))
  throw new Error('Fail closed: staging-only passphrase, exact deployed SHA, and fixed origin are required.');

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
  {label:'desktop',width:1440,height:900},
  {label:'tablet',width:834,height:1112},
  {label:'mobile',width:390,height:844},
] as const;

test.beforeAll(async ({request})=>{
  const response=await request.get('/api/release/identity');
  expect(response.status()).toBe(200);
  const identity=await response.json() as {sha:string|null;environment:string};
  expect(identity.environment).toBe('staging');
  expect(identity.sha,'Runtime SHA must match the checked-out and approved candidate').toBe(expectedSha);
});

test.beforeEach(async ({page})=>{
  const login=await page.request.post('/api/auth/staging-login',{
    headers:{Origin:origin},data:{passphrase},
  });
  expect(login.status(),'Staging login did not authorize').toBe(200);
  const probe=await page.request.get('/api/auth/staging-login');
  expect(probe.status()).toBe(200);
  expect((await probe.json() as {authenticated:boolean}).authenticated).toBe(true);
});

async function navigate(page:Page,name:string){
  const nav=page.getByRole('navigation',{name:'Módulos empresariais'});
  if(!(await nav.isVisible()))await page.getByRole('button',{name:'Abrir menu'}).click();
  // OS nav includes an authorized count badge, so the accessible name includes it.
  const button=name==='Ordens de serviço'
    ?nav.getByRole('button',{name:/^Ordens de serviço/})
    :nav.getByRole('button',{name,exact:true});
  if(!(await button.isVisible()))
    await button.locator('xpath=ancestor::*[contains(@class,"nav-group")]').locator('.nav-group-toggle').click();
  await button.click();
  await expect(page.locator('.topbar [aria-current="page"]')).toHaveText(name);
  await expect(page.locator('#cisne-workspace-content')).toBeVisible();
}

function watchErrors(page:Page){
  const apiFailures:string[]=[];
  const hydration:string[]=[];
  page.on('response',response=>{
    const url=new URL(response.url());
    if(url.origin===origin&&url.pathname.startsWith('/api/')&&
       ([401,403].includes(response.status())||response.status()>=500))
      apiFailures.push(response.status()+' '+url.pathname);
  });
  page.on('console',message=>{
    if(message.type()==='error'&&/hydration|server rendered html|mismatch/i.test(message.text()))
      hydration.push('Hydration failure');
  });
  return {apiFailures,hydration};
}

// Real HTTP only. No route.fulfill, page.route, stubbed identity or synthetic business response.
for(const name of destinations){
  test('Authenticated navigation: '+name,async ({page})=>{
    const failures=watchErrors(page);
    await page.goto('/');
    for(const size of viewports){
      await page.setViewportSize({width:size.width,height:size.height});
      await navigate(page,name);
      await page.waitForLoadState('networkidle',{timeout:15000});
      const content=await page.locator('#cisne-workspace-content').innerText();
      expect(content).not.toMatch(/STAGING_PRIVATE_ACCESS_REQUIRED|acesso não autenticado|credencial autorizada|HTTP 40[13]/i);
      expect(failures.apiFailures).toEqual([]);
      expect(failures.hydration).toEqual([]);
      const bar=await page.locator('.topbar').evaluate(el=>({scroll:el.scrollWidth,client:el.clientWidth}));
      expect(bar.scroll).toBeLessThanOrEqual(bar.client+2);
      const slug=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
        .replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      await page.screenshot({path:test.info().outputPath(slug+'-'+size.label+'.png'),fullPage:true});
    }
  });
}
test('Authenticated real client Object Page and persisted identity',async ({page})=>{
  const response=await page.request.get('/api/clients?page=1&pageSize=1&sort=name.asc');
  expect(response.status()).toBe(200);
  const body=await response.json() as {items?:{id:string;legalName:string}[]};
  const first=body.items?.[0];
  expect(first,'No authorized isolated staging client seed exists; do not substitute a mock').toBeDefined();
  if(!first)return;
  const record=await page.request.get('/api/clients/'+encodeURIComponent(first.id));
  expect(record.status()).toBe(200);
  const detail=await record.json() as {projection?:{id:string;related:unknown}};
  expect(detail.projection?.id).toBe(first.id);
  expect(detail.projection?.related).toBeDefined();
  const failures=watchErrors(page);
  await page.goto('/');
  await navigate(page,'Clientes e propostas');
  await page.getByRole('grid',{name:'Lista de clientes'})
    .getByRole('button',{name:first.legalName,exact:true}).click();
  await expect(page.locator('#cisne-workspace-content')).toContainText(first.legalName);
  expect(failures.apiFailures).toEqual([]);
  await page.screenshot({path:test.info().outputPath('client-object-authenticated-desktop.png'),fullPage:true});
});


test('Authenticated inventory and MRP views are distinct with real APIs',async({page})=>{
 const failures=watchErrors(page);
 await page.goto('/');
 await navigate(page,'Estoque e compras');
 for(const size of viewports){
  await page.setViewportSize({width:size.width,height:size.height});
  const inventory=page.getByRole('tab',{name:'Estoque e materiais'});
  const mrp=page.getByRole('tab',{name:'Planejamento MRP'});
  await expect(inventory).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('tabpanel',{name:'Estoque e materiais'})).toBeVisible();
  await mrp.click();
  await expect(mrp).toHaveAttribute('aria-selected','true');
  await expect(page.getByRole('tabpanel',{name:'Planejamento MRP'})).toBeVisible();
  expect(failures.apiFailures).toEqual([]);
  await page.screenshot({path:test.info().outputPath('mrp-authenticated-'+size.label+'.png'),fullPage:true});
  await inventory.click();
 }
});

test('Authenticated service order keeps its persisted identity from API through Object Page',async({page})=>{
 const list=await page.request.get('/api/orders?page=1&pageSize=1&sort=createdAt.desc&view=Todas%20as%20ordens&category=Todas%20as%20atividades');
 expect(list.status()).toBe(200);
 const d=await list.json() as {orders?:Array<{id:string;title:string}>};
 const first=d.orders?.[0];
 expect(first,'No approved staging OS exists; no fallback to a mock').toBeDefined();
 if(!first)return;
 const details=await page.request.get('/api/orders/'+encodeURIComponent(first.id));
 expect(details.status()).toBe(200);
 const failures=watchErrors(page);
 await page.goto('/');
 await navigate(page,'Centro de operações');
 await expect(page.getByText(first.title).first()).toBeVisible();
 await page.getByRole('button',{name:'Abrir objeto completo'}).click();
 await expect(page.locator('#cisne-workspace-content')).toContainText(first.title);
 expect(failures.apiFailures).toEqual([]);
 await page.screenshot({path:test.info().outputPath('order-object-authenticated-desktop.png'),fullPage:true});
});
