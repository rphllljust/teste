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
  await expect(grid).toBeVisible();
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
  expect(gridViewport.overflowX).toBe('auto');
  expect(gridViewport.scrollWidth).toBeGreaterThanOrEqual(gridViewport.clientWidth);
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
