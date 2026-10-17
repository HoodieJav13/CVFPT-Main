import { defineConfig } from '@playwright/test';

// Paired before/after capture for the P2 frame-selection correction: the same
// test-only harness state against the pinned candidate checkout
// (CVF_P2_BEFORE_DIR, at 335588e) and this tree. Headless only; no backend.
const beforeDir = process.env.CVF_P2_BEFORE_DIR;
if (!beforeDir) throw new Error('Set CVF_P2_BEFORE_DIR to the pinned candidate checkout root');
const env = { ...process.env, REACT_APP_BACKEND_URL: '', REACT_APP_PREVIEW_MODE: 'false' };
export default defineConfig({
  outputDir: './test-results-media-visual',
  testDir: './e2e',
  testMatch: 'exercise-media-p2-frame.capture.mjs',
  timeout: 120_000, fullyParallel: false, workers: 1, retries: 0, reporter: 'line',
  expect: { timeout: 30_000 },
  projects: [
    { name: 'before', use: { baseURL: 'http://127.0.0.1:42794' } },
    { name: 'after', use: { baseURL: 'http://127.0.0.1:42793' } },
  ],
  webServer: [
    { command: 'npm run dev -- --host 127.0.0.1 --port 42793 --strictPort', url: 'http://127.0.0.1:42793', reuseExistingServer: false, timeout: 120_000, env },
    { command: `npm --prefix "${beforeDir}/frontend" run dev -- --host 127.0.0.1 --port 42794 --strictPort`, url: 'http://127.0.0.1:42794', reuseExistingServer: false, timeout: 120_000, env },
  ],
});
