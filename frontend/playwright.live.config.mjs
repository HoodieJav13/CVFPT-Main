import { defineConfig } from '@playwright/test';

const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: './e2e',
  testMatch: 'live-auth.spec.mjs',
  timeout: 600_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    extraHTTPHeaders: protectionBypass ? {
      'x-vercel-protection-bypass': protectionBypass,
    } : undefined,
    // Live fake-account credentials are entered through the UI. Do not persist
    // action parameters, DOM snapshots, or screenshots that could capture them.
    trace: 'off',
    screenshot: 'off',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174',
    env: {
      ...process.env,
      REACT_APP_BACKEND_URL: protectionBypass ? '' : process.env.REACT_APP_BACKEND_URL,
      REACT_APP_PREVIEW_MODE: 'false',
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
