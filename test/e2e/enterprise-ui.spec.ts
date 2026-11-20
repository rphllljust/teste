import { expect, test } from '@playwright/test';

const orderList = {
  orders: [],
  total: 0,
  summary: { total: 0, drafts: 0, planned: 0, pendingMeasurements: 0 },
};

test('global shell hydrates Fluent controls and keeps workspace navigation usable', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Clientes e propostas' })).toBeVisible();
  await page.getByRole('button', { name: 'Clientes e propostas' }).click();
  await expect(page.getByRole('heading', { name: 'Clientes', exact: true })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Buscar clientes' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cadastrar cliente' })).toBeVisible();
  expect(await page.locator('button[class*="fui-Button"]').count()).toBeGreaterThan(0);
  expect(consoleErrors.filter(message => /hydration|server rendered html/i.test(message))).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('clients-desktop.png'), fullPage: true });
});

test('resource workspace uses the Fluent DataGrid and real filter state', async ({ page }) => {
  await page.route('**/api/professionals?*', route => route.fulfill({ json: { items: [
    { id: 'test-professional-1', name: 'Profissional de teste', registration: 'T-001', specialty: 'Campo', department: 'Operações', status: 'active' },
  ] } }));
  await page.route('**/api/assets?*', route => route.fulfill({ json: { items: [
    { id: 'test-asset-1', name: 'Veículo de teste', code: 'T-V-01', kind: 'vehicle', location: 'Base', status: 'active', hourlyCost: 12500 },
  ] } }));
  await page.route('**/api/orders?*', route => route.fulfill({ json: orderList }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Resource Planning Board' }).click();
  await expect(page.getByRole('heading', { name: 'Planejamento de recursos' })).toBeVisible();
  const grid = page.getByRole('grid', { name: 'Recursos operacionais' });
  await expect(grid).toBeVisible();
  await expect(grid.getByText('Profissional de teste')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('resource-grid-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(grid).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('resource-grid-tablet.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileList = page.getByRole('list', { name: 'Recursos operacionais — versão compacta' });
  await expect(mobileList).toBeVisible();
  await expect(mobileList.getByText('Profissional de teste')).toBeVisible();
  await expect(mobileList.getByText('T-001')).toBeVisible();
  await expect(grid).toBeHidden();
  const searchWidth = await page.getByRole('searchbox', { name: 'Buscar recurso' }).evaluate(element => element.getBoundingClientRect().width);
  expect(searchWidth).toBeGreaterThanOrEqual(200);
  const topbarFits = await page.locator('.topbar').evaluate(element => element.scrollWidth <= element.clientWidth);
  expect(topbarFits).toBeTruthy();
  const searchLabelHidden = await page.locator('.global-search-label').evaluate(element => getComputedStyle(element).display === 'none');
  expect(searchLabelHidden).toBeTruthy();
  const workspacePillWidth = await page.locator('.app-mode-pill').evaluate(element => element.getBoundingClientRect().width);
  expect(workspacePillWidth).toBeLessThanOrEqual(36);
  const gridViewport = await page.locator('.enterprise-data-grid').evaluate(element => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    overflowX: getComputedStyle(element).overflowX,
  }));
  expect(gridViewport.overflowX).toBe('visible');
  expect(gridViewport.scrollWidth).toBeLessThanOrEqual(gridViewport.clientWidth + 2);
  await page.screenshot({ path: test.info().outputPath('resource-grid-mobile.png'), fullPage: true });
});

test('client create dialog uses a Fluent dialog and closes without writing data', async ({ page }) => {
  await page.route('**/api/clients?*', route => route.fulfill({ json: { items: [], pageInfo: { total: 0, sourceTotal: 0, hasMore: false } } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Clientes e propostas' }).click();
  await page.getByRole('button', { name: 'Cadastrar cliente' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cadastrar cliente' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Razão social / nome')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('controlled Fluent contract filter sends the selected status to the real query layer', async ({ page }) => {
  const statuses: string[] = [];
  await page.route('**/api/contracts?*', async route => {
    const url = new URL(route.request().url());
    statuses.push(url.searchParams.get('status') ?? '');
    await route.fulfill({ json: { items: [], pageInfo: { total: 0, sourceTotal: 0, hasMore: false } } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Contratos', exact: true }).click();
  const status = page.getByRole('combobox', { name: 'Situação do contrato' });
  await expect(status).toBeVisible();
  await status.click();
  await page.getByRole('option', { name: 'Ativo', exact: true }).click();
  await expect.poll(() => statuses.includes('active')).toBeTruthy();
});

test('uncontrolled Fluent dropdown submits the actual accounting nature through FormData', async ({ page }) => {
  let submittedType: string | undefined;
  await page.route('**/api/accounting/accounts', async route => {
    if (route.request().method() === 'POST') {
      const payload = route.request().postDataJSON() as { type?: string };
      submittedType = payload.type;
      await route.fulfill({ json: {} });
      return;
    }
    await route.fulfill({ json: { items: [] } });
  });
  await page.route('**/api/accounting/journals?*', route =>
    route.fulfill({ json: { items: [], pageInfo: { hasMore: false } } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Contabilidade', exact: true }).click();
  await page.getByRole('button', { name: 'Nova conta' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cadastrar conta contábil' });
  await dialog.getByLabel('Código').fill('1.02');
  await dialog.getByLabel('Nome').fill('Conta de validação');
  await dialog.getByRole('combobox').click();
  await page.getByRole('option', { name: 'Receita', exact: true }).click();
  await dialog.getByRole('button', { name: 'Registrar conta' }).click();
  await expect.poll(() => submittedType).toBe('revenue');
});


test('enterprise navigation is collapsible, keyboard operable, and preserves selected workspace', async ({ page }) => {
  await page.goto('/');
  const group = page.getByRole('button', { name: 'RELACIONAMENTO', exact: true });
  const crm = page.getByRole('button', { name: 'CRM e Vendas', exact: true });
  await expect(group).toHaveAttribute('aria-expanded', 'true');
  await group.focus();
  await page.keyboard.press('Enter');
  await expect(group).toHaveAttribute('aria-expanded', 'false');
  await expect(crm).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(group).toHaveAttribute('aria-expanded', 'true');
  await crm.click();
  await expect(page.locator('.topbar').getByText('Relacionamento')).toBeVisible();
  await expect(crm).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#cisne-workspace-content')).toBeVisible();
});


test('client list report renders real Fluent grid, searches API and clears filters without a write', async ({ page }) => {
  const queries: string[] = [];
  await page.route('**/api/clients?*', async route => {
    queries.push(new URL(route.request().url()).searchParams.get('q') ?? '');
    await route.fulfill({ json: {
      items: [{ id: 'client-fixture-1', legalName: 'Cliente de homologação', tradeName: 'Unidade Centro', document: '00.000.000/0001-00', email: null, phone: null, state: { code: 'active', label: 'Ativo', rowVersion: 1 }, availableCommands: [] }],
      pageInfo: { total: 1, sourceTotal: 1, hasMore: false },
    } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Clientes e propostas' }).click();
  const grid = page.getByRole('grid', { name: 'Lista de clientes' });
  await expect(grid).toBeVisible();
  await expect(grid.getByText('Cliente de homologação')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Buscar clientes' }).fill('homologação');
  await expect.poll(() => queries.includes('homologação')).toBeTruthy();
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await expect(page.getByRole('searchbox', { name: 'Buscar clientes' })).toHaveValue('');
  await expect.poll(() => queries[queries.length - 1]).toBe('');
});


test('operations control center is reachable and opens the existing service-order context', async ({ page }) => {
  await page.route('**/api/orders?*', route => route.fulfill({ json: {
    orders: [{ id: 'order-fixture-1', title: 'OS de validação', client: 'Cliente de homologação', category: 'Serviços', description: 'Serviço controlado', status: 'DRAFT', due_date: null, created_at: '2026-11-20T10:00:00Z', availableCommands: [], relations: { measurements: 0, invoices: 0, receivables: 0 } }],
    total: 1, summary: { total: 1, drafts: 1, planned: 0, pendingMeasurements: 0 },
  } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Centro de operações', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Centro de operações' })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Buscar ordens de serviço' })).toBeVisible();
  await expect(page.getByText('OS de validação').first()).toBeVisible();
  await page.getByRole('button', { name: 'Abrir objeto completo' }).click();
  await expect(page.locator('.topbar')).toContainText('Ordens de serviço');
});


test('professional details only expose populated summary and history tabs', async ({ page }) => {
  await page.route('**/api/professionals?*', route => route.fulfill({ json: {
    items: [{ id: 'professional-fixture-1', name: 'Técnica de homologação', registration: 'REG-001',
      specialty: 'Campo', department: 'Operações', phone: null, hourlyCost: null,
      status: 'active', rowVersion: 1 }],
  } }));
  await page.route('**/api/professionals/professional-fixture-1', route => route.fulfill({ json: {
    professional: { id: 'professional-fixture-1', name: 'Técnica de homologação', registration: 'REG-001',
      specialty: 'Campo', department: 'Operações', phone: null, hourlyCost: null,
      status: 'active', rowVersion: 1, availableCommands: [], history: [
        { command: 'register', createdAt: '2026-11-20T10:00:00Z' },
      ] },
  } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Profissionais', exact: true }).click();
  const grid = page.getByRole('grid', { name: 'Profissionais e equipes autorizados' });
  await expect(grid.getByText('Técnica de homologação')).toBeVisible();
  await grid.getByRole('button', { name: 'Técnica de homologação' }).click();
  const drawer = page.getByRole('dialog', { name: 'Object Page do profissional' });
  await expect(drawer.getByRole('tabpanel')).toContainText('Especialidade');
  await drawer.getByRole('tab', { name: 'Histórico' }).click();
  await expect(drawer.getByRole('tabpanel')).toContainText('Cadastro registrado');
  await expect(drawer.getByRole('button', { name: 'Editar cadastro' })).toHaveCount(0);
});


test('clients List Report sorts in the backend and resets the server query',async ({page})=>{
 const sorts:string[]=[];
 await page.route('**/api/clients?*',async route=>{
   sorts.push(new URL(route.request().url()).searchParams.get('sort')??'');
   await route.fulfill({json:{items:[],pageInfo:{total:0,sourceTotal:0,hasMore:false}}});
 });
 await page.goto('/');
 await page.getByRole('button',{name:'Clientes e propostas'}).click();
 const select=page.getByRole('combobox',{name:'Ordenar clientes'});
 await select.click();
 await page.getByRole('option',{name:'Mais recentes',exact:true}).click();
 await expect.poll(()=>sorts.includes('recent')).toBeTruthy();
 await page.getByRole('button',{name:'Limpar filtros'}).click();
 await expect.poll(()=>sorts[sorts.length-1]).toBe('name.asc');
});

test('Redwood task view prioritizes overdue payables using real dueTo and outstanding API filters',async ({page})=>{
 const queries:string[]=[];
 await page.route('**/api/payables?*',async route=>{
   queries.push(route.request().url());
   await route.fulfill({json:{items:[],pageInfo:{total:0,sourceTotal:0,hasMore:false},aggregates:[],generatedAt:new Date().toISOString()}});
 });
 await page.route('**/api/views?*',route=>route.fulfill({json:{views:[]}}));
 await page.goto('/');
 await page.getByRole('button',{name:'Contas a pagar',exact:true}).click();
 await page.getByRole('button',{name:'Priorizar títulos vencidos'}).click();
 await expect.poll(()=>queries.some(q=>{
   const p=new URL(q).searchParams;
   return p.get('state')==='outstanding'&&p.get('sort')==='dueDate.asc'&&!!p.get('dueTo');
 })).toBeTruthy();
 await expect(page.getByText(/Fila de obrigações com saldo e vencimento/)).toBeVisible();
});


test('mobile List Report preserves all client fields, actions and record identity without horizontal table',async({page})=>{
 await page.route('**/api/clients?*',route=>route.fulfill({json:{
  items:[{id:'mobile-client-1',legalName:'Cliente Móvel',tradeName:'Unidade 01',
   document:'12345678000190',email:'cliente@example.invalid',phone:null,
   state:{code:'active',label:'Ativo',rowVersion:1},availableCommands:[]}],
  pageInfo:{total:1,sourceTotal:1,hasMore:false},
 }}));
 await page.setViewportSize({width:390,height:844});
 await page.goto('/');
 await page.getByRole('button',{name:'Abrir menu'}).click();
 await page.getByRole('navigation',{name:'Módulos empresariais'})
  .getByRole('button',{name:'Clientes e propostas'}).click();
 const records=page.getByRole('list',{name:'Lista de clientes — versão compacta'});
 await expect(records).toBeVisible();
 await expect(records.getByText('Cliente Móvel')).toBeVisible();
 await expect(records.getByText('12345678000190')).toBeVisible();
 await expect(records.getByText('cliente@example.invalid')).toBeVisible();
 await expect(records.getByRole('button',{name:'Cliente Móvel'})).toBeVisible();
 await expect(page.getByRole('grid',{name:'Lista de clientes'})).toBeHidden();
});


test('Redwood priority task opens the real orders queue filtered for completed work without measurement',async({page})=>{
 await page.route('**/api/orders?*',route=>route.fulfill({json:{
  orders:[],total:4,summary:{total:4,drafts:1,planned:0,pendingMeasurements:2},
 }}));
 await page.goto('/');
 await page.getByRole('button',{name:'Visão operacional',exact:true}).click();
 const pending=page.getByRole('button',{name:/Aguardando medição/}).first();
 await expect(pending).toBeVisible();
 await pending.click();
 await expect(page.locator('.topbar')).toContainText('Ordens de serviço');
 await expect(page.getByRole('button',{name:'Concluídas sem medição',exact:true}))
  .toHaveAttribute('aria-pressed','true');
});


test('operations cockpit paginates without silently truncating server results',async({page})=>{
 const visited:number[]=[];
 await page.route('**/api/orders?*',async route=>{
   const current=Number(new URL(route.request().url()).searchParams.get('page')??1);
   visited.push(current);
   await route.fulfill({json:{
    orders:[{id:'order-page-'+current,title:'OS página '+current,client:'Cliente controle',
      category:'Serviços',description:'Serviço',status:'DRAFT',due_date:null,
      created_at:'2026-11-20T10:00:00Z',availableCommands:[],
      relations:{measurements:0,invoices:0,receivables:0}}],
    total:27,pageInfo:{page:current,total:27,hasMore:current===1},
    summary:{total:27,drafts:27,planned:0,pendingMeasurements:0},
   }});
 });
 await page.goto('/');
 await page.getByRole('button',{name:'Centro de operações',exact:true}).click();
 await expect(page.getByText('OS página 1').first()).toBeVisible();
 await page.getByRole('button',{name:'Próxima página'}).click();
 await expect.poll(()=>visited.includes(2)).toBeTruthy();
 await expect(page.getByText('OS página 2').first()).toBeVisible();
 await expect(page.getByRole('button',{name:'Próxima página'})).toBeDisabled();
 await page.getByRole('button',{name:'Página anterior'}).click();
 await expect.poll(()=>visited.filter(value=>value===1).length).toBeGreaterThan(1);
});


test('commercial proposal and contract sorting passes whitelisted values to the real query layer',async({page})=>{
 const proposalSorts:string[]=[];
 const contractSorts:string[]=[];
 await page.route('**/api/proposals?*',route=>{
  proposalSorts.push(new URL(route.request().url()).searchParams.get('sort')??'');
  return route.fulfill({json:{items:[],pageInfo:{total:0,sourceTotal:0,hasMore:false}}});
 });
 await page.route('**/api/contracts?*',route=>{
  contractSorts.push(new URL(route.request().url()).searchParams.get('sort')??'');
  return route.fulfill({json:{items:[],pageInfo:{total:0,sourceTotal:0,hasMore:false}}});
 });
 await page.goto('/');
 await page.getByRole('button',{name:'Propostas e PO',exact:true}).click();
 await page.getByRole('combobox',{name:'Ordenação comercial'}).click();
 await page.getByRole('option',{name:'Título A–Z',exact:true}).first().click();
 await expect.poll(()=>proposalSorts.includes('title.asc')).toBeTruthy();
 await page.getByRole('button',{name:'Contratos',exact:true}).click();
 await page.getByRole('combobox',{name:'Ordenar contratos'}).click();
 await page.getByRole('option',{name:'Referência Z–A',exact:true}).first().click();
 await expect.poll(()=>contractSorts.includes('reference.desc')).toBeTruthy();
});


test('completed OS without actual measurement does not claim measurement or billing completion',async({page})=>{
 await page.route('**/api/orders?*',route=>route.fulfill({json:{
  orders:[{id:'order-complete-no-measurement',title:'OS sem medição',
    client:'Cliente cenário',category:'Serviços',description:'Execução encerrada',
    status:'COMPLETED',due_date:null,created_at:'2026-11-20T10:00:00Z',
    relations:{measurements:0,invoices:0,receivables:0},availableCommands:[]}],
  total:1,pageInfo:{page:1,total:1,hasMore:false},
  summary:{total:1,drafts:0,planned:0,pendingMeasurements:1},
 }}));
 await page.goto('/');
 await page.getByRole('button',{name:'Centro de operações',exact:true}).click();
 await expect(page.getByRole('heading',{name:'OS sem medição'})).toBeVisible();
 const measurement=page.locator('.service-progress').getByText('Medições vinculadas');
 const billing=page.locator('.service-progress').getByText('Faturamento vinculado');
 await expect(measurement).not.toHaveClass(/has-record|done/);
 await expect(billing).not.toHaveClass(/has-record|done/);
 await expect(page.locator('.service-inspector')).toContainText('0 medições');
});


test('Redwood control tower refreshes real API query contracts and opens the financial workspace (mocked UI)',async({page})=>{
 const queried:string[]=[];
 await page.route('**/api/enterprise/control-tower*',route=>{
  queried.push(new URL(route.request().url()).searchParams.get('asOf')??'');
  const specs=[
   ['lateOrders','Ordens em atraso','Centro de operações'],
   ['unmeasuredOrders','Concluídas sem medição aprovada','Medições'],
   ['overdueReceivables','Recebíveis vencidos','Financeiro'],
   ['overduePayables','Obrigações vencidas','Contas a pagar'],
   ['latePurchases','Compras não recebidas no prazo','Compras'],
   ['stockShortage','Materiais abaixo do mínimo','Estoque e compras'],
   ['myApprovals','Aprovações atribuídas','Visão operacional'],
  ];
  return route.fulfill({json:{
   asOf:'2026-11-20',generatedAt:'2026-11-20T12:00:00.000Z',
   authority:'owner_scoped_persisted_postgresql.v1',sampleLimitPerLane:6,
   lanes:specs.map(([id,label,target])=>({
    id,label,target,count:id==='overdueReceivables'?2:0,
    authority:'SYNTHETIC_UI_CONTRACT',totalAmountScaled:id==='overdueReceivables'?'600000':null,
    items:id==='overdueReceivables'?[{
     id:'synthetic-a',title:'Título ilustrativo',reference:null,date:'2026-11-10',
     amountScaled:'600000',availableScaled:null,requiredScaled:null,unit:null,
    }]:[],
   })),
  }});
 });
 await page.goto('/');
 const tower=page.getByRole('region',{name:'Central de exceções empresariais'});
 await expect(tower).toBeVisible();
 const lane=tower.getByRole('article',{name:'Recebíveis vencidos'});
 await expect(lane).toContainText('2 registros');
 await expect(lane).toContainText('R$');
 const date=tower.getByLabel('Data de referência das exceções');
 await date.fill('2026-11-21');
 await expect.poll(()=>queried.includes('2026-11-21')).toBeTruthy();
 await tower.getByRole('button',{name:'Atualizar exceções'}).click();
 await expect.poll(()=>queried.filter(x=>x==='2026-11-21').length).toBeGreaterThan(1);
 await lane.getByRole('button',{name:'Abrir área'}).click();
 await expect(page.locator('.topbar [aria-current="page"]')).toHaveText('Financeiro');
});

test('Redwood control tower uses server-valued queues and opens an exact payable Object Page',async({page})=>{
 const lanes=[
  ['lateOrders','Ordens em atraso','Centro de operações',[]],
  ['unmeasuredOrders','Concluídas sem medição aprovada','Medições',[]],
  ['overdueReceivables','Recebíveis vencidos','Financeiro',[]],
  ['overduePayables','Obrigações vencidas','Contas a pagar',[
   {id:'payable-control-1',title:'Fornecedor pendente',reference:'DOC-001',
    date:'2026-11-10',amountScaled:'1000000',availableScaled:null,requiredScaled:null}]],
  ['latePurchases','Compras não recebidas no prazo','Compras',[]],
  ['stockShortage','Materiais abaixo do mínimo','Estoque e compras',[]],
  ['myApprovals','Aprovações atribuídas','Fechamentos',[]],
 ] as const;
 let detailRequests=0;
 await page.route('**/api/enterprise/control-tower*',route=>route.fulfill({json:{
  authority:'owner_scoped_persisted_postgresql.v1',asOf:'2026-11-20',
  generatedAt:'2026-11-20T14:00:00.000Z',sampleLimitPerLane:6,
  lanes:lanes.map(([id,label,target,items])=>({
   id,label,target,count:items.length,totalAmountScaled:id==='overduePayables'?'1000000':null,
   authority:'SYNTHETIC_CONTRACT_TEST',items,
  })),
 }}));
 await page.route('**/api/payables?*',route=>route.fulfill({json:{
  items:[],pageInfo:{total:0,sourceTotal:0,hasMore:false},aggregates:[],
  generatedAt:'2026-11-20T14:00:00.000Z',
 }}));
 await page.route('**/api/views?*',route=>route.fulfill({json:{views:[]}}));
 await page.route('**/api/payables/payable-control-1?*',route=>{
  detailRequests++;
  return route.fulfill({json:{projection:{
   identity:{id:'payable-control-1',title:'Fornecedor pendente',subtitle:'DOC-001'},
   state:{code:'outstanding',label:'Pendente',rowVersion:1},
   facts:{principalScaled:'1000000',paidScaled:'0',outstandingScaled:'1000000',dueDate:'2026-11-10'},
   source:{reference:'DOC-001',description:'Compra de teste'},
   payments:[],paymentsPageInfo:{page:1,total:0,hasMore:false},availableCommands:[],warnings:[],
  }}});
 });
 await page.goto('/');
 const tower=page.getByRole('region',{name:'Central de exceções empresariais'});
 await expect(tower).toBeVisible();
 const payableLane=tower.getByRole('article',{name:'Obrigações vencidas'});
 await expect(payableLane).toContainText('1 registro');
 await expect(payableLane).toContainText('Fornecedor pendente');
 await expect(payableLane).toContainText('R$');
 await payableLane.getByRole('button',{name:'Abrir Fornecedor pendente'}).click();
 await expect(page.locator('.topbar')).toContainText('Contas a pagar');
 await expect.poll(()=>detailRequests).toBeGreaterThan(0);
 await expect(page.getByRole('region',{name:'Obrigação Fornecedor pendente'})).toBeVisible();
 await expect(page.getByRole('main')).toHaveCount(1);
});

test('Redwood control tower fails closed when the API is unavailable',async({page})=>{
 await page.route('**/api/enterprise/control-tower*',route=>route.fulfill({status:503,
  json:{error:'O serviço de prioridades está temporariamente indisponível.'}}));
 await page.goto('/');
 const tower=page.getByRole('region',{name:'Central de exceções empresariais'});
 await expect(tower.getByRole('alert')).toContainText('temporariamente indisponível');
 await expect(tower.getByRole('article')).toHaveCount(0);
 await expect(tower.getByRole('button',{name:'Tentar novamente'})).toBeVisible();
});

test('procurement List Report paginates server-side and resets page on business filter',async({page})=>{
 const pages:number[]=[];
 await page.route('**/api/procurement?*',route=>{
  const params=new URL(route.request().url()).searchParams;
  const current=Number(params.get('page')??1);
  pages.push(current);
  return route.fulfill({json:{
   items:[{id:'ci-order-'+current,reference:'PC-CI-'+current,
    total:100000,expectedOn:'2026-12-01',status:'draft',rowVersion:1,
    supplier:'Fornecedor CI',lineCount:1,quantity:1000,receivedQuantity:0}],
   total:26,page:current,hasMore:current===1,
   summary:{total:26,draft:26,approved:0},suppliers:[],inventoryItems:[],
  }});
 });
 await page.route('**/api/procurement/ci-order-*',route=>route.fulfill({json:{
  order:{id:'ci-order',reference:'PC-CI-1',supplier:'Fornecedor CI',status:'draft',total:100000,
   expectedOn:'2026-12-01',rowVersion:1,quantity:1000,receivedQuantity:0},
  lines:[],receipts:[],reconciled:false,
 }}));
 await page.goto('/');
 await page.getByRole('button',{name:'Compras',exact:true}).click();
 const paginator=page.getByRole('navigation',{name:'Paginação de compras'});
 await expect(paginator).toContainText('26 pedidos no filtro');
 await paginator.getByRole('button',{name:'Próxima'}).click();
 await expect.poll(()=>pages.includes(2)).toBeTruthy();
 await expect(page.getByText('PC-CI-2').first()).toBeVisible();
 await page.getByRole('button',{name:'Aprovação',exact:true}).click();
 await expect.poll(()=>pages.filter(n=>n===1).length).toBeGreaterThan(1);
 await expect(paginator).toContainText('Página 1');
 await expect(page.getByRole('main')).toHaveCount(1);
});


test('inventory search, stock intervention and next page are separate server-backed filters',async({page})=>{
 const queries:string[]=[];
 await page.route('**/api/inventory?*',route=>{
  const params=new URL(route.request().url()).searchParams;
  if(params.has('item'))return route.fulfill({status:404,json:{error:'No detail required'}});
  const pageNo=Number(params.get('page')??1);
  const low=params.get('lowOnly')==='1';
  queries.push(route.request().url());
  const item={id:'item-ci-'+pageNo,sku:'CISNE-'+pageNo,
   name:'Material pagina '+pageNo,unit:'un',minimum:low?2000:0,
   balance:1000,available:1000};
  return route.fulfill({json:{items:[item],page:pageNo,hasMore:!low&&pageNo===1,
   matched:low?1:26,summary:{total:26,low:1}}});
 });
 await page.goto('/');
 await page.getByRole('button',{name:'Estoque e compras',exact:true}).click();
 const paginator=page.getByRole('navigation',{name:'Paginação de estoque'});
 await expect(paginator).toContainText('26 materiais no filtro');
 await paginator.getByRole('button',{name:'Próxima'}).click();
 await expect.poll(()=>queries.some(q=>new URL(q).searchParams.get('page')==='2')).toBeTruthy();
 await expect(page.getByText('CISNE-2').first()).toBeVisible();
 await page.getByRole('button',{name:'Intervenção',exact:true}).click();
 await expect.poll(()=>queries.some(q=>{
  const p=new URL(q).searchParams;return p.get('page')==='1'&&p.get('lowOnly')==='1';
 })).toBeTruthy();
 await expect(paginator).toContainText('1 materiais no filtro');
 await expect(page.getByRole('main')).toHaveCount(1);
});


test('Redwood approvals inbox presents a real confirmation and submits a versioned authorized decision (mocked UI contract)',async({page})=>{
 let decided=false;
 const id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const item={id,entityType:'finance_period_close',entityId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   command:'close',state:'pending',requestedBy:'other-owner',rowVersion:1,createdAt:'2026-11-20T10:00:00.000Z',decidedAt:null};
 const specs=[
  ['lateOrders','Ordens em atraso','Centro de operações'],
  ['unmeasuredOrders','Concluídas sem medição aprovada','Medições'],
  ['overdueReceivables','Recebíveis vencidos','Financeiro'],
  ['overduePayables','Obrigações vencidas','Contas a pagar'],
  ['latePurchases','Compras não recebidas no prazo','Compras'],
  ['stockShortage','Materiais abaixo do mínimo','Estoque e compras'],
  ['myApprovals','Aprovações atribuídas','Visão operacional'],
 ];
 await page.route('**/api/enterprise/control-tower*',route=>route.fulfill({json:{
   authority:'owner_scoped_persisted_postgresql.v1',asOf:'2026-11-20',generatedAt:'2026-11-20T12:00:00.000Z',
   sampleLimitPerLane:6,lanes:specs.map(([key,label,target])=>({
    id:key,label,target,count:key==='myApprovals'&&!decided?1:0,
    authority:'SYNTHETIC_UI_TEST',totalAmountScaled:null,
    items:key==='myApprovals'&&!decided?[{
     id,title:'finance_period_close · close',date:item.createdAt,reference:null,
     amountScaled:null,availableScaled:null,requiredScaled:null,unit:null,
    }]:[],
   })),
 }}));
 await page.route('**/api/workflow/approvals?*',route=>{
  const state=new URL(route.request().url()).searchParams.get('state');
  const items=state==='pending'&&!decided?[item]:state==='approved'&&decided?[{...item,state:'approved',rowVersion:2}]:[];
  return route.fulfill({json:{authority:'assigned_approver_postgresql.v1',
   page:1,state,total:items.length,hasMore:false,items}});
 });
 await page.route('**/api/workflow/approvals/'+id+'/commands',route=>{
  decided=true;
  return route.fulfill({json:{id,state:'approved',rowVersion:2,replayed:false}});
 });
 await page.goto('/');
 await page.getByRole('region',{name:'Central de exceções empresariais'})
   .getByRole('button',{name:'Abrir aprovações'}).click();
 const inbox=page.getByRole('region',{name:'Aprovações atribuídas'});
 await expect(inbox.getByText('Fechamento de período financeiro').first()).toBeVisible();
 await inbox.getByRole('button',{name:'Avaliar aprovação'}).click();
 const dialog=page.getByRole('dialog',{name:'Confirmar decisão da aprovação'});
 await expect(dialog).toContainText('segregação de funções');
 const requestReceived=page.waitForRequest(request=>
   request.method()==='POST'&&request.url().includes('/api/workflow/approvals/'+id+'/commands'));
 await dialog.getByRole('button',{name:'Confirmar aprovação'}).click();
 const submitted=(await requestReceived).postDataJSON() as Record<string,unknown>;
 expect(submitted.command).toBe('approve');
 expect(submitted.version).toBe(1);
 expect(String(submitted.key)).toMatch(/^[a-f0-9-]{36}$/);
 await expect(page.getByRole('status').getByText('Decisão aprovada e registrada no servidor.',{exact:true})).toBeVisible({timeout:15000});
 await inbox.getByRole('button',{name:'Aprovadas'}).click();
 await expect(inbox.getByText('Fechamento de período financeiro').first()).toBeVisible();
 await expect(inbox.getByRole('button',{name:'Avaliar aprovação'})).toHaveCount(0);
});
