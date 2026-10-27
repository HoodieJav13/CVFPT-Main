import { defineConfig } from '@playwright/test';
// Normal mode, synthetic API only.
export default defineConfig({
 testDir: './tests/browser', testMatch: 'workout-ux*.spec.mjs', timeout: 30_000, workers: 1, retries: 0, reporter: 'line',
 use: { baseURL: 'http://127.0.0.1:42743', trace: 'retain-on-failure' },
 webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 42743 --strictPort', url: 'http://127.0.0.1:42743', reuseExistingServer: false, env: { ...process.env, REACT_APP_BACKEND_URL: '', REACT_APP_PREVIEW_MODE: 'false' } },
});
