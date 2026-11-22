import { expect, test } from '@playwright/test';

const emptyOrders = {
  orders: [], total: 0,
  summary: { total: 0, drafts: 0, planned: 0, pendingMeasurements: 0 },
};

test('new CISNE enterprise launchpad is visibly different and routes into all six domains', async ({ page }) => {
  await page.route('**/api/orders?*', route => route.fulfill({ json: emptyOrders }));
  await page.goto('/');
  const launchpad = page.getByRole('region', { name: 'Centro de comando empresarial' });
  await expect(launchpad.getByRole('heading', { name: 'O negócio inteiro, em uma só visão.' })).toBeVisible();
  await expect(launchpad.getByRole('heading', { name: 'Trabalhe por processo, não por formulário' })).toBeVisible();
  for (const title of ['Operação', 'Relacionamento', 'Planejamento', 'Finanças', 'Suprimentos', 'Governança']) {
    await expect(launchpad.getByRole('button', { name: new RegExp('Abrir área ' + title + ':') })).toBeVisible();
  }
  const heroBg = await page.locator('.cisne-command-hero').evaluate(node => getComputedStyle(node).backgroundImage);
  expect(heroBg).toContain('gradient');
  await launchpad.getByRole('button', { name: 'Abrir área Finanças: Visão financeira' }).click();
  await expect(page.locator('.topbar [aria-current="page"]')).toHaveText('Visão financeira');
  await expect(page.locator('.sidebar')).toBeVisible();
  const sidebarBg = await page.locator('.sidebar').evaluate(node => getComputedStyle(node).backgroundColor);
  expect(sidebarBg).toBe('rgb(251, 252, 255)');
});

test('launchpad never renders unauthorized counts as verified zero', async ({ page }) => {
  await page.route('**/api/orders?*', route => route.fulfill({
    status: 403, json: { error: 'Acesso não autorizado.' },
  }));
  await page.goto('/');
  const launchpad = page.getByRole('region', { name: 'Centro de comando empresarial' });
  await expect(launchpad.getByText('Indicadores indisponíveis.', { exact: false })).toBeVisible();
  for (const label of ['Ordens no contexto', 'Em planejamento', 'Aguardando medição', 'Rascunhos']) {
    const metric = launchpad.getByRole('button', { name: new RegExp('^' + label + ': indisponível') });
    await expect(metric).toBeVisible();
    await expect(metric.locator('.cisne-command-metric-value')).toHaveText('—');
  }
  await launchpad.getByRole('button', { name: 'Entrar no centro de operações' }).click();
  await expect(page.locator('.topbar [aria-current="page"]')).toHaveText('Centro de operações');
});

test('new enterprise home is usable on a 390px mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/orders?*', route => route.fulfill({ json: emptyOrders }));
  await page.goto('/');
  const launchpad = page.getByRole('region', { name: 'Centro de comando empresarial' });
  await expect(launchpad.getByRole('heading', { name: 'O negócio inteiro, em uma só visão.' })).toBeVisible();
  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth + 2);
  await page.getByRole('button', { name: 'Abrir menu' }).click();
  await expect(page.getByRole('button', { name: 'Contas a pagar', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Contas a pagar', exact: true }).click();
  await expect(page.locator('.topbar [aria-current="page"]')).toHaveText('Contas a pagar');
});
