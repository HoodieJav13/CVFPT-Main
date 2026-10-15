import { defineConfig } from '@playwright/test';

// Paired visual capture: identical mocked data/assets against the baseline
// checkout (CVF_VISUAL_BASELINE_DIR, at 8d68a78) and this tree. Normal
// (non-preview) builds; no backend; headless only.
const baselineDir = process.env.CVF_VISUAL_BASELINE_DIR;
if (!baselineDir) throw new Error('Set CVF_VISUAL_BASELINE_DIR to the baseline checkout root');
const env = { ...process.env, REACT_APP_BACKEND_URL: '', REACT_APP_PREVIEW_MODE: 'false' };
export default defineConfig({
  outputDir: './test-results-media-visual',
  testDir: './e2e',
  testMatch: 'exercise-media-visual.capture.mjs',
  timeout: 120_000, fullyParallel: false, workers: 1, retries: 0, reporter: 'line',
  // First page loads on a cold dev server compile on demand.
  expect: { timeout: 30_000 },
  projects: [
    { name: 'baseline', use: { baseURL: 'http://127.0.0.1:42792' } },
    { name: 'proposed', use: { baseURL: 'http://127.0.0.1:42791' } },
  ],
  webServer: [
    { command: 'npm run dev -- --host 127.0.0.1 --port 42791 --strictPort', url: 'http://127.0.0.1:42791', reuseExistingServer: false, timeout: 120_000, env },
    { command: `npm --prefix "${baselineDir}/frontend" run dev -- --host 127.0.0.1 --port 42792 --strictPort`, url: 'http://127.0.0.1:42792', reuseExistingServer: false, timeout: 120_000, env },
  ],
});
