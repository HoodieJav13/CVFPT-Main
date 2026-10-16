import { defineConfig } from '@playwright/test';

// Exercise media, normal (non-preview) build with every /api call intercepted
// by page.route. No backend, no real auth; previewMode.js is not loaded.
export default defineConfig({
  outputDir: './test-results-media',
  testDir: './e2e',
  // Mocked media lane plus the real VideoSelectionEditor frame-selection harness.
  testMatch: ['exercise-media-mocked.spec.mjs', 'exercise-media-frame-selection.spec.mjs'],
  timeout: 60_000, fullyParallel: false, workers: 1, retries: 0, reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:42761', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 42761 --strictPort',
    url: 'http://127.0.0.1:42761',
    env: { ...process.env, REACT_APP_BACKEND_URL: '', REACT_APP_PREVIEW_MODE: 'false' },
    // Never reuse: a foreign server on the port must be a loud error.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
