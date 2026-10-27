import { defineConfig } from '@playwright/test';

// Normal build, synthetic API only: preview intentionally resets on reload.
export default defineConfig({
  testDir: './tests/browser', testMatch: ['workout-metrics-mocked.spec.mjs', 'workout-outbox-mocked.spec.mjs'],
  timeout: 60_000, workers: 1, retries: 0, reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:4176', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4176',
    url: 'http://127.0.0.1:4176', reuseExistingServer: false, timeout: 120_000,
    env: { ...process.env, REACT_APP_BACKEND_URL: '', REACT_APP_PREVIEW_MODE: 'false' },
  },
});
