import { defineConfig } from '@playwright/test';
// Focused Look A specs on their own port (never 4317 or 42761). Normal mode, synthetic API only.
export default defineConfig({
 testDir: './tests/browser', testMatch: process.env.LOOK_A_SPECS || 'workout-ux-look-a-*.spec.mjs', timeout: 45_000, workers: 1, retries: 0, reporter: 'line',
 outputDir: 'test-results/look-a',
 use: { baseURL: 'http://127.0.0.1:42800', trace: 'retain-on-failure' },
 webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 42800 --strictPort', url: 'http://127.0.0.1:42800', reuseExistingServer: false, env: { ...process.env, REACT_APP_BACKEND_URL: '', REACT_APP_PREVIEW_MODE: 'false' } },
});
