import { defineConfig } from '@playwright/test';

// SEPARATE, opt-in real-provider proof (contacts YouTube; never in CI). Test-only
// harness page, headless, no app data/accounts/cookies/tokens.
export default defineConfig({
  outputDir: './test-results-guides-proof',
  testDir: './e2e',
  testMatch: 'youtube-provider-proof.spec.mjs',
  timeout: 90_000, workers: 1, retries: 0, reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:42767', trace: 'off' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 42767 --strictPort',
    url: 'http://127.0.0.1:42767',
    env: { ...process.env, REACT_APP_BACKEND_URL: '', REACT_APP_PREVIEW_MODE: 'false' },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
