import { defineConfig } from '@playwright/test';
// Redesign gate proof (docs/redesign-gate.md). Two dev servers from this same folder:
// one with the gate off (the default), one with REACT_APP_PT_REDESIGN=look-a.
// Normal mode, synthetic API only, headless.
export const OFF_URL = 'http://127.0.0.1:42811';
export const ON_URL = 'http://127.0.0.1:42812';
const base = { ...process.env, REACT_APP_BACKEND_URL: '', REACT_APP_PREVIEW_MODE: 'false' };
const off = { ...base };
delete off.REACT_APP_PT_REDESIGN;
export default defineConfig({
  testDir: './tests/redesign-gate', testMatch: '*.spec.mjs', timeout: 45_000, workers: 1, retries: 0, reporter: 'line',
  outputDir: 'test-results/redesign-gate',
  use: { trace: 'retain-on-failure', headless: true },
  webServer: [
    { command: 'npm run dev -- --host 127.0.0.1 --port 42811 --strictPort', url: OFF_URL, reuseExistingServer: false, env: off },
    { command: 'npm run dev -- --host 127.0.0.1 --port 42812 --strictPort', url: ON_URL, reuseExistingServer: false, env: { ...base, REACT_APP_PT_REDESIGN: 'look-a' } },
  ],
});
