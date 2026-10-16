import { defineConfig } from '@playwright/test';

// Paired before/after capture for the residual R2 fix (saved time changed
// while the crop is open): the same test-only harness sequence against the
// pinned c64d17c checkout (CVF_R2_BEFORE_DIR) and this tree. Headless only.
const beforeDir = process.env.CVF_R2_BEFORE_DIR;
if (!beforeDir) throw new Error('Set CVF_R2_BEFORE_DIR to the pinned c64d17c checkout root');
const env = { ...process.env, REACT_APP_BACKEND_URL: '', REACT_APP_PREVIEW_MODE: 'false' };
export default defineConfig({
  outputDir: './test-results-media-visual',
  testDir: './e2e',
  testMatch: 'exercise-media-r2-selection.capture.mjs',
  timeout: 120_000, fullyParallel: false, workers: 1, retries: 0, reporter: 'line',
  expect: { timeout: 30_000 },
  projects: [
    { name: 'before', use: { baseURL: 'http://127.0.0.1:42796' } },
    { name: 'after', use: { baseURL: 'http://127.0.0.1:42795' } },
  ],
  webServer: [
    { command: 'npm run dev -- --host 127.0.0.1 --port 42795 --strictPort', url: 'http://127.0.0.1:42795', reuseExistingServer: false, timeout: 120_000, env },
    { command: `npm --prefix "${beforeDir}/frontend" run dev -- --host 127.0.0.1 --port 42796 --strictPort`, url: 'http://127.0.0.1:42796', reuseExistingServer: false, timeout: 120_000, env },
  ],
});
