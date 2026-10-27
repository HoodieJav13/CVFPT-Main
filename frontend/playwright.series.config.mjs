import { defineConfig } from '@playwright/test';

// Recurring-sessions browser tests: a normal (non-preview) dev build whose API calls are
// intercepted with page.route. No backend, no real auth, previewMode.js untouched.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'series-mocked.spec.mjs',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:4175', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4175',
    url: 'http://127.0.0.1:4175',
    env: { ...process.env, REACT_APP_BACKEND_URL: '', REACT_APP_PREVIEW_MODE: 'false' },
    // Never reuse: a foreign server on the port must be a loud error.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
