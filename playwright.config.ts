import { defineConfig, devices } from '@playwright/test';

const externalBaseURL = process.env.CISNE_BASE_URL;

export default defineConfig({
  testDir: './test/e2e',
  // Prevent mocked/local tests from silently becoming authenticated staging evidence.
  testMatch: process.env.CISNE_AUTHENTICATED_E2E === '1' ? ['**/staging-authenticated.spec.ts'] : undefined,
  testIgnore: process.env.CISNE_AUTHENTICATED_E2E === '1' ? [] : ['**/staging-authenticated.spec.ts'],
  workers: process.env.CISNE_AUTHENTICATED_E2E === '1' ? 1 : undefined,
  timeout: process.env.CISNE_AUTHENTICATED_E2E === '1' ? 90000 : 30000,
  outputDir: './test-results/enterprise',
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: externalBaseURL ?? 'http://127.0.0.1:8787',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        ? ['--single-process', '--no-zygote']
        : undefined,
    },
    ...devices['Desktop Chrome'],
  },
  webServer: externalBaseURL ? undefined : {
    command: 'pnpm start',
    url: 'http://127.0.0.1:8787',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
