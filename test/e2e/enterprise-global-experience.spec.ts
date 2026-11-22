import { expect, test } from '@playwright/test';

// These checks exercise the real shared React shell. No business data or authorization is mocked.
test('global workcenter is available across operation, CRM and finance with real navigation', async ({ page }) => {
  await page.goto('/');
  const hub = page.getByRole('region', { name: 'Área de trabalho empresarial' });
  await expect(hub.locator('.cisne-enterprise-hub-heading-title').filter({ hasText: 'Visão operacional' })).toBeVisible();
  await hub.getByRole('link', { name: 'Abrir jornada Vender: Clientes e propostas' }).click();
  await expect(hub.locator('.cisne-enterprise-hub-heading-title').filter({ hasText: 'Clientes e propostas' })).toBeVisible();
  await expect(page).toHaveURL(/Clientes%20e%20propostas/);
  await hub.getByRole('link', { name: 'Abrir jornada Controlar: Visão financeira' }).click();
  await expect(hub.locator('.cisne-enterprise-hub-heading-title').filter({ hasText: 'Visão financeira' })).toBeVisible();
  await expect(page).toHaveURL(/Vis%C3%A3o%20financeira/);
});

test('catalog searches actual module destinations and never fabricates links', async ({ page }) => {
  await page.goto('/');
  const hub = page.getByRole('region', { name: 'Área de trabalho empresarial' });
  await hub.getByRole('button', { name: 'Todos os módulos' }).click();
  await expect(hub.getByRole('heading', { name: 'Catálogo de áreas de trabalho' })).toBeVisible();
  await hub.getByRole('searchbox', { name: 'Filtrar módulos' }).fill('Contratos');
  await expect(hub.getByRole('link', { name: 'Abrir módulo Contratos' })).toBeVisible();
  await expect(hub.getByRole('link', { name: 'Abrir módulo Tesouraria' })).toHaveCount(0);
  await hub.getByRole('link', { name: 'Abrir módulo Contratos' }).click();
  await expect(hub.locator('.cisne-enterprise-hub-heading-title').filter({ hasText: 'Contratos' })).toBeVisible();
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
  await expect(favorites.getByRole('link', { name: 'Abrir favorito Visão operacional' })).toBeVisible();
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


test('enterprise priorities are loaded on demand and cannot disguise HTTP 403 as an empty business queue', async ({ page }) => {
  let towerRequests = 0;
  await page.route('**/api/enterprise/control-tower*', route => {
    towerRequests++;
    return route.fulfill({ status: 403, json: { error: 'Acesso empresarial não autorizado.' } });
  });
  await page.goto('/');
  const hub = page.getByRole('region', { name: 'Área de trabalho empresarial' });
  await expect(hub).toBeVisible();
  expect(towerRequests).toBe(0);
  await hub.getByRole('button', { name: 'Prioridades reais' }).click();
  await expect(hub.getByRole('region', { name: 'Prioridades globais com dados autorizados' })).toBeVisible();
  await expect(hub.getByRole('alert').getByText('Acesso empresarial não autorizado.')).toBeVisible();
  expect(towerRequests).toBe(1);
  await hub.getByRole('button', { name: 'Ocultar prioridades' }).click();
  await expect(hub.getByRole('region', { name: 'Prioridades globais com dados autorizados' })).toHaveCount(0);
});

// Synthetic authorization fixture: tests the existing real drilldown wiring, not staging business acceptance.
test('owner-scoped control tower links an enterprise exception to the real module', async ({ page }) => {
  const ids = [
    ['lateOrders', 'Ordens com atraso'],
    ['unmeasuredOrders', 'Sem medição'],
    ['overdueReceivables', 'Recebíveis atrasados'],
    ['overduePayables', 'Pagamentos atrasados'],
    ['latePurchases', 'Compras atrasadas'],
    ['stockShortage', 'Materiais abaixo do mínimo'],
    ['myApprovals', 'Aprovações'],
  ] as const;
  await page.route('**/api/enterprise/control-tower*', route => route.fulfill({
    json: {
      asOf: '2026-11-21', generatedAt: '2026-11-21T12:00:00Z',
      authority: 'owner_scoped_persisted_postgresql.v1', sampleLimitPerLane: 10,
      lanes: ids.map(([id, label], index) => ({
        id, label, target: 'enterprise', count: index === 0 ? 1 : 0,
        totalAmountScaled: null, authority: 'owner_scoped_persisted_postgresql.v1',
        items: [],
      })),
    },
  }));
  await page.goto('/');
  const hub = page.getByRole('region', { name: 'Área de trabalho empresarial' });
  await hub.getByRole('button', { name: 'Prioridades reais' }).click();
  await expect(hub.getByRole('heading', { name: 'Ordens com atraso' })).toBeVisible();
  await hub.getByRole('article', { name: 'Ordens com atraso' }).getByRole('button', { name: 'Abrir área' }).click();
  await expect(hub.locator('.cisne-enterprise-hub-heading-title').filter({ hasText: 'Centro de operações' })).toBeVisible();
  await expect(page).toHaveURL(/Centro%20de%20opera%C3%A7%C3%B5es/);
});


test('mobile workcenter header has content-sized height, not desktop flex-basis whitespace', async ({ page }) => {
  await page.goto('/');
  const hub = page.getByRole('region', { name: 'Área de trabalho empresarial' });
  const banner = hub.locator('.cisne-enterprise-hub-banner');
  const heading = banner.locator('.cisne-enterprise-hub-heading');
  const actions = banner.locator('.cisne-enterprise-hub-actions');

  for (const width of [320, 390, 414, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(heading).toBeVisible();
    await expect(actions.getByRole('button', { name: 'Pesquisar registros' })).toBeVisible();

    const geometry = await banner.evaluate(element => {
      const headingRect = element.querySelector('.cisne-enterprise-hub-heading')!.getBoundingClientRect();
      const actionRect = element.querySelector('.cisne-enterprise-hub-actions')!.getBoundingClientRect();
      const bannerRect = element.getBoundingClientRect();
      return {
        direction: getComputedStyle(element).flexDirection,
        headingBasis: getComputedStyle(element.querySelector('.cisne-enterprise-hub-heading')!).flexBasis,
        gap: actionRect.top - headingRect.bottom,
        actionBottom: actionRect.bottom,
        bannerBottom: bannerRect.bottom,
        actionRight: actionRect.right,
        bannerRight: bannerRect.right,
      };
    });
    expect(geometry.direction).toBe('column');
    expect(geometry.headingBasis).toBe('auto');
    expect(geometry.gap).toBeGreaterThanOrEqual(0);
    expect(geometry.gap).toBeLessThanOrEqual(28);
    expect(geometry.actionBottom).toBeLessThanOrEqual(geometry.bannerBottom + 1);
    expect(geometry.actionRight).toBeLessThanOrEqual(geometry.bannerRight + 1);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await hub.getByRole('button', { name: 'Usar visualização compacta' }).click();
  const compactGap = await banner.evaluate(element => {
    const headingBottom = element.querySelector('.cisne-enterprise-hub-heading')!.getBoundingClientRect().bottom;
    const actionsTop = element.querySelector('.cisne-enterprise-hub-actions')!.getBoundingClientRect().top;
    return actionsTop - headingBottom;
  });
  expect(compactGap).toBeLessThanOrEqual(28);
});
