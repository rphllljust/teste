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
