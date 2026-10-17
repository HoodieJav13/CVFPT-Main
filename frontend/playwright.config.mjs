import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // These suites own their server/config: series/auth mock real mode, analytics uses a local collector.
  testIgnore: ['**/invite-visual.spec.mjs', '**/client-invites-mocked.spec.mjs', '**/series-mocked.spec.mjs', '**/quick-sessions-mocked.spec.mjs', '**/coach-analytics.spec.mjs', '**/auth-session.spec.mjs',
    // Exercise media: normal-mode mocked and real-local lanes own their own servers.
    '**/exercise-media-mocked.spec.mjs', '**/exercise-media-local.spec.mjs', '**/exercise-media-frame-selection.spec.mjs',
    // Exercise guides: mocked normal-mode, real-local and the opt-in real-provider proof own theirs.
    '**/exercise-guides-player.spec.mjs', '**/exercise-guides-still.spec.mjs', '**/exercise-guides-editor.spec.mjs', '**/exercise-guides-local.spec.mjs', '**/youtube-provider-proof.spec.mjs'],
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  use: {
    baseURL: 'http://127.0.0.1:42731',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev:preview -- --host 127.0.0.1 --port 42731',
    url: 'http://127.0.0.1:42731',
    // Never reuse: a foreign server on our port once made the whole suite
    // silently test a different app. A busy port must be a loud error.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
