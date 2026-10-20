import { defineConfig } from '@playwright/test';

// Exercise guides (photo + YouTube demos), normal (non-preview) build. Every
// /api call AND every YouTube host is intercepted by page.route; the provider is
// a deterministic stub, so this lane proves app behavior only (never Google's
// availability). No backend, no real auth; previewMode.js is not loaded.
export default defineConfig({
  outputDir: './test-results-guides',
  testDir: './e2e',
  testMatch: ['exercise-guides-player.spec.mjs', 'exercise-guides-still.spec.mjs', 'exercise-guides-editor.spec.mjs', 'exercise-guides-editor-seams.spec.mjs'],
  timeout: 60_000, fullyParallel: false, workers: 1, retries: 0, reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:42766', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 42766 --strictPort',
    url: 'http://127.0.0.1:42766',
    env: { ...process.env, REACT_APP_BACKEND_URL: '', REACT_APP_PREVIEW_MODE: 'false' },
    // Never reuse: a foreign server on the port must be a loud error.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
