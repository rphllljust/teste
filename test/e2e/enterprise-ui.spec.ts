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
