import { expect, test } from '@playwright/test';

const emptyOrders = {
  orders: [],
  total: 0,
  summary: { total: 0, drafts: 0, planned: 0, pendingMeasurements: 0 },
};

test.describe('Enterprise command center authorization contract', () => {
  test('does not represent denied operational indicators as verified zero', async ({ page }) => {
    await page.route('**/api/orders?*', route =>
      route.fulfill({ status: 403, json: { error: 'Acesso não autorizado.' } }),
    );
    await page.goto('/');
    const commandCenter = page.locator('.enterprise-command-center');
    await expect(commandCenter).toBeVisible();
    await expect(commandCenter.getByText('Indicadores indisponíveis.', { exact: false })).toBeVisible();
    await expect(commandCenter.locator('.enterprise-lanes strong')).toHaveCount(2);
    await expect(commandCenter.locator('.enterprise-lanes strong').first()).toHaveText('—');
    await expect(commandCenter.locator('.enterprise-lanes strong').last()).toHaveText('—');
  });

  test('renders an authorized zero only after successful API response', async ({ page }) => {
    await page.route('**/api/orders?*', route =>
      route.fulfill({ status: 200, json: emptyOrders }),
    );
    await page.goto('/');
    const commandCenter = page.locator('.enterprise-command-center');
    await expect(commandCenter).toBeVisible();
    await expect(commandCenter.locator('.enterprise-lanes strong')).toHaveCount(2);
    await expect(commandCenter.locator('.enterprise-lanes strong').first()).toHaveText('0');
    await expect(commandCenter.locator('.enterprise-lanes strong').last()).toHaveText('0');
  });
});
