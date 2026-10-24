import { defineConfig } from '@playwright/test';

// Paired visual capture for Photo + YouTube guides: identical mocked API data and
// the same real processed synthetic posters, served to the pinned baseline
// checkout (CVF_GUIDES_BASELINE_DIR, at f3c063c) and to this tree. Normal
// (non-preview) builds; no backend; every YouTube host is a deterministic stub;
// headless only.
const baselineDir = process.env.CVF_GUIDES_BASELINE_DIR;
if (!baselineDir) throw new Error('Set CVF_GUIDES_BASELINE_DIR to the pinned f3c063c checkout root');
const env = { ...process.env, REACT_APP_BACKEND_URL: '', REACT_APP_PREVIEW_MODE: 'false' };
export default defineConfig({
  outputDir: './test-results-guides-visual',
  testDir: './e2e',
  testMatch: 'exercise-guides-visual.capture.mjs',
  timeout: 180_000, fullyParallel: false, workers: 1, retries: 0, reporter: 'line',
  // First page loads on a cold dev server compile on demand.
  expect: { timeout: 30_000 },
  projects: [
    { name: 'baseline', use: { baseURL: 'http://127.0.0.1:42804' } },
    { name: 'proposed', use: { baseURL: 'http://127.0.0.1:42803' } },
  ],
  webServer: [
    { command: 'npm run dev -- --host 127.0.0.1 --port 42803 --strictPort', url: 'http://127.0.0.1:42803', reuseExistingServer: false, timeout: 120_000, env },
    { command: `npm --prefix "${baselineDir}/frontend" run dev -- --host 127.0.0.1 --port 42804 --strictPort`, url: 'http://127.0.0.1:42804', reuseExistingServer: false, timeout: 120_000, env },
  ],
});
