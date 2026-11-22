import { expect, test } from '@playwright/test';

// These checks exercise the real shared React shell. No business data or authorization is mocked.
test('global workcenter is available across operation, CRM and finance with real navigation', async ({ page }) => {
  await page.goto('/');
  const hub = page.getByRole('region', { name: 'Área de trabalho empresarial' });
  await expect(hub.getByRole('heading', { name: 'Visão operacional' })).toBeVisible();
  await hub.getByRole('button', { name: 'Abrir jornada Vender: Clientes e propostas' }).click();
  await expect(hub.getByRole('heading', { name: 'Clientes e propostas' })).toBeVisible();
  await expect(page).toHaveURL(/Clientes%20e%20propostas/);
  await hub.getByRole('button', { name: 'Abrir jornada Controlar: Visão financeira' }).click();
  await expect(hub.getByRole('heading', { name: 'Visão financeira' })).toBeVisible();
  await expect(page).toHaveURL(/Vis%C3%A3o%20financeira/);
});

test('catalog searches actual module destinations and never fabricates links', async ({ page }) => {
  await page.goto('/');
  const hub = page.getByRole('region', { name: 'Área de trabalho empresarial' });
  await hub.getByRole('button', { name: 'Todos os módulos' }).click();
  await expect(hub.getByRole('heading', { name: 'Catálogo de áreas de trabalho' })).toBeVisible();
  await hub.getByRole('searchbox', { name: 'Filtrar módulos' }).fill('Contratos');
  await expect(hub.getByRole('button', { name: 'Abrir módulo Contratos' })).toBeVisible();
  await expect(hub.getByRole('button', { name: 'Abrir módulo Tesouraria' })).toHaveCount(0);
  await hub.getByRole('button', { name: 'Abrir módulo Contratos' }).click();
  await expect(hub.getByRole('heading', { name: 'Contratos', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#Contratos/);
});

test('favorites and density preference survive navigation and reload', async ({ page }) => {
  await page.goto('/');
  const hub = page.getByRole('region', { name: 'Área de trabalho empresarial' });
  await hub.getByRole('button', { name: 'Adicionar Visão operacional aos favoritos' }).click();
  await expect(hub.getByRole('button', { name: 'Remover Visão operacional dos favoritos' })).toBeVisible();
  await hub.getByRole('button', { name: 'Usar visualização compacta' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-cisne-density', 'compact');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-cisne-density', 'compact');
  await hub.getByRole('button', { name: 'Todos os módulos' }).click();
  const favorites = hub.getByRole('region', { name: 'Módulos favoritos' });
  await expect(favorites.getByRole('button', { name: 'Abrir favorito Visão operacional' })).toBeVisible();
});

test('workcenter reflows without a horizontal document overflow at desktop, tablet and mobile', async ({ page }) => {
  await page.goto('/');
  for (const width of [1440, 834, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const hub = page.getByRole('region', { name: 'Área de trabalho empresarial' });
    await expect(hub).toBeVisible();
    const layout = await hub.evaluate(element => ({
      width: element.getBoundingClientRect().width,
      viewport: window.innerWidth,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(layout.width).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.documentOverflow).toBeLessThanOrEqual(2);
    await page.screenshot({ path: test.info().outputPath('enterprise-hub-' + width + '.png'), fullPage: false });
  }
});
