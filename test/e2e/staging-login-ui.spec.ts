import { expect, test } from '@playwright/test';

// These are UI contract tests. Route responses below are synthetic and cannot
// replace the separate authenticated staging test suite with real PostgreSQL.
test('session gateway is absent when the API is unavailable outside staging', async ({ page }) => {
  await page.route('**/api/auth/staging-login', route => route.fulfill({
    status: 404, json: { error: 'Not found' },
  }));
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Autenticação de homologação' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Área de trabalho empresarial' })).toBeVisible();
});

test('staging gateway validates the passphrase locally and renders server auth failures', async ({ page }) => {
  let loginRequests = 0;
  await page.route('**/api/auth/staging-login', route => {
    if (route.request().method() === 'POST') {
      loginRequests++;
      return route.fulfill({ status: 401, json: { error: 'Credencial não autorizada.' } });
    }
    return route.fulfill({ json: { authenticated: false } });
  });
  await page.goto('/');
  const gateway = page.getByRole('region', { name: 'Autenticação de homologação' });
  await expect(gateway.getByText('Entre para consultar registros autorizados')).toBeVisible();
  const submit = gateway.getByRole('button', { name: 'Entrar na homologação' });
  await expect(submit).toBeDisabled();
  await gateway.getByRole('textbox', { name: 'Frase de acesso da homologação' }).fill('a'.repeat(24));
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(gateway.getByRole('alert')).toHaveText('Credencial não autorizada. Confira a frase de acesso.');
  await expect(gateway.getByRole('textbox', { name: 'Frase de acesso da homologação' })).toHaveValue('');
  expect(loginRequests).toBe(1);
});

test('gateway confirms the server session and supports verified sign-out', async ({ page }) => {
  let authenticated = false;
  let signInRequests = 0;
  let signOutRequests = 0;
  await page.route('**/api/auth/staging-login', route => {
    const method = route.request().method();
    if (method === 'POST') {
      signInRequests++;
      authenticated = true;
      return route.fulfill({ json: { authenticated: true } });
    }
    if (method === 'DELETE') {
      signOutRequests++;
      authenticated = false;
      return route.fulfill({ json: { authenticated: false } });
    }
    return route.fulfill({ json: { authenticated } });
  });
  await page.goto('/');
  const gateway = page.getByRole('region', { name: 'Autenticação de homologação' });
  await gateway.getByRole('textbox', { name: 'Frase de acesso da homologação' }).fill('x'.repeat(25));
  await gateway.getByRole('button', { name: 'Entrar na homologação' }).click();
  await expect(gateway.getByRole('button', { name: 'Encerrar sessão de homologação' })).toBeVisible();
  expect(signInRequests).toBe(1);
  await gateway.getByRole('button', { name: 'Encerrar sessão de homologação' }).click();
  await expect(gateway.getByText('Entre para consultar registros autorizados')).toBeVisible();
  expect(signOutRequests).toBe(1);
});
