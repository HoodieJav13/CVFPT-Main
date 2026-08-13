import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  use: {
    baseURL: 'http://127.0.0.1:42731',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev:preview -- --host 127.0.0.1 --port 42731',
    url: 'http://127.0.0.1:42731',
    // Never reuse: a foreign server on our port once made the whole suite
    // silently test a different app. A busy port must be a loud error.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
