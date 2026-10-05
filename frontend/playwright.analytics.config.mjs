import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: 'coach-analytics.spec.mjs',
  timeout: 60000, workers: 1, retries: 0, reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:42732', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev:preview -- --host 127.0.0.1 --port 42732',
    url: 'http://127.0.0.1:42732', reuseExistingServer: false,
    env: {
      ...process.env, VERCEL_ENV: '', REACT_APP_POSTHOG_MODE: 'local',
      REACT_APP_POSTHOG_HOST: '', REACT_APP_POSTHOG_PUBLIC_TOKEN: '', REACT_APP_SENTRY_DSN: '',
    },
  },
});
