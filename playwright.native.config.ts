import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'native.spec.ts',
  outputDir: 'test-results/native',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  workers: 2,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report/native' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build:native && npm exec vite -- preview --config vite.native.config.ts --outDir dist-native --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174/native.html',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: 'native-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'native-webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
