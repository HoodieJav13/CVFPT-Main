import { defineConfig } from '@playwright/test';

// Exercise media on REAL local services: the owned launcher starts the
// disposable database, PostgREST, fictional loopback auth, the real API and
// worker, and the real (non-preview) frontend with a synthetic account picker.
// Requires Docker and the task-built processor image. Never targets hosted
// services. Playwright stops the launcher with SIGTERM; it then tears down
// only what it owns.
export default defineConfig({
  outputDir: './test-results-media-local',
  testDir: './e2e',
  testMatch: 'exercise-media-local.spec.mjs',
  timeout: 240_000, fullyParallel: false, workers: 1, retries: 0, reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:42771', trace: 'retain-on-failure' },
  webServer: {
    command: 'node ../backend/integration/exercise-media-dev.cjs --port 42771 --seed-media',
    url: 'http://127.0.0.1:42771/__media-demo',
    reuseExistingServer: false,
    timeout: 400_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 90_000 },
    stdout: 'pipe',
  },
});
