import { defineConfig } from '@playwright/test';

// Default exercise guides (photos + YouTube links) on REAL local services: the
// owned photos launcher starts the disposable database, PostgREST, fictional
// loopback auth, the real API (in-process image processor, NO worker) and the
// real non-preview frontend. Never targets hosted services. Playwright stops
// the launcher with SIGTERM; it tears down only what it owns.
export default defineConfig({
  outputDir: './test-results-guides-local',
  testDir: './e2e',
  testMatch: 'exercise-guides-local.spec.mjs',
  timeout: 240_000, fullyParallel: false, workers: 1, retries: 0, reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:42781', trace: 'retain-on-failure' },
  webServer: {
    command: 'node ../backend/integration/exercise-media-dev.cjs --port 42781 --seed-media',
    url: 'http://127.0.0.1:42781/__media-demo',
    reuseExistingServer: false,
    timeout: 400_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 90_000 },
    stdout: 'pipe',
  },
});
