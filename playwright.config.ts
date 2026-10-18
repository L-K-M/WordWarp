import { defineConfig, devices } from '@playwright/test';

const configuredBase = process.env.VITE_BASE_PATH ?? '/';
const basePath = configuredBase.startsWith('/') ? configuredBase : `/${configuredBase}`;
const normalizedBasePath = basePath.endsWith('/') ? basePath : `${basePath}/`;

export default defineConfig({
  testDir: './tests',
  testIgnore: 'native.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : 'list',
  use: {
    baseURL: `http://127.0.0.1:4173${normalizedBasePath}`,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173',
    url: `http://127.0.0.1:4173${normalizedBasePath}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'mobile-webkit', use: { ...devices['iPhone 13'] } },
  ],
});
