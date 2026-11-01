import { defineConfig } from '@playwright/test';

// Production entry points with fictional, intercepted API responses. Keep this
// separate from the fixture-enabled Preview server; never reuse an old build.
const baseURL = 'http://127.0.0.1:43561';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'pt-release-normal.spec.mjs',
  outputDir: './test-results/pt-release-normal',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL,
    // A production service worker must not bypass the spec's network guard.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run build -- --outDir dist/pt-release-normal && npm run preview -- --host 127.0.0.1 --port 43561 --strictPort --outDir dist/pt-release-normal',
    url: baseURL,
    env: {
      VERCEL_ENV: 'production',
      REACT_APP_BACKEND_URL: '',
      REACT_APP_PREVIEW_MODE: 'false',
      REACT_APP_HOSTED_DEMO: 'false',
      REACT_APP_POSTHOG_MODE: 'off',
      REACT_APP_POSTHOG_HOST: '',
      REACT_APP_POSTHOG_PUBLIC_TOKEN: '',
      REACT_APP_SENTRY_DSN: '',
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
