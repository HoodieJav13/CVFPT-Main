import { defineConfig } from '@playwright/test';

// Quick-session recovery/race browser tests (A4-A6): a normal (non-preview) dev build whose API
// calls are intercepted with page.route by an in-test fake backend that survives page reloads.
// No backend, no real auth or notifications, previewMode.js untouched. Its own port keeps it
// isolated from the preview, series and analytics servers.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'quick-sessions-mocked.spec.mjs',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:4178', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4178',
    url: 'http://127.0.0.1:4178',
    env: { ...process.env, REACT_APP_BACKEND_URL: '', REACT_APP_PREVIEW_MODE: 'false' },
    // Never reuse: a foreign server on the port must be a loud error.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
