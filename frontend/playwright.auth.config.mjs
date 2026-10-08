import { defineConfig } from '@playwright/test';

// Exercise real AuthProvider behavior using only fictional, intercepted local requests.
export default defineConfig({
  testDir: './e2e', testMatch: 'auth-session.spec.mjs',
  timeout: 30_000, workers: 1, retries: 0, reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:42734', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 42734',
    url: 'http://127.0.0.1:42734', reuseExistingServer: false,
    env: {
      ...process.env, VERCEL_ENV: '', REACT_APP_BACKEND_URL: '',
      REACT_APP_PREVIEW_MODE: 'false', REACT_APP_HOSTED_DEMO: 'false',
      REACT_APP_POSTHOG_MODE: 'off', REACT_APP_POSTHOG_PUBLIC_TOKEN: '',
      REACT_APP_POSTHOG_HOST: '', REACT_APP_SENTRY_DSN: '',
      CVF_E2E_BACKEND_URL: '', VERCEL_AUTOMATION_BYPASS_SECRET: '',
    },
  },
});
