// SEPARATE real-provider proof (not part of CI or the deterministic lanes):
// loads the app's real player module on a test-only page with Google's own
// IFrame API documentation sample video, headless, with no app data, accounts,
// cookies or tokens. It shows what the real provider did on this machine at
// this time; it is not proof of availability elsewhere or on a real phone.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

test.setTimeout(90_000);
const SAMPLE = process.env.CVF_YT_PROOF_ID || 'M7lc1UVf-VE';
const OUT = path.join(import.meta.dirname, '..', 'test-results-guides-proof', 'youtube-provider-proof.json');

test('real provider: nothing before Play; privacy-enhanced embed with origin-only referrer after', async ({ page, baseURL }) => {
  const requests = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== new URL(baseURL).origin) requests.push({ host: url.hostname, path: url.pathname, type: request.resourceType(), referer: request.headers().referer || null, at: Date.now() });
  });
  await page.goto(`/e2e/harness/youtube-proof.html?v=${SAMPLE}`);
  await page.waitForTimeout(1000);
  const beforePlay = requests.length;
  const clickedAt = Date.now();
  await page.click('#play');
  const outcome = await page.waitForFunction(() => {
    const last = window.__proof.states.at(-1);
    return last && last.state !== 'loading' ? last : null;
  }, null, { timeout: 45_000 }).then((handle) => handle.jsonValue()).catch(() => ({ state: 'timeout' }));
  const iframe = page.locator('iframe');
  const src = await iframe.getAttribute('src').catch(() => null);
  const box = await iframe.boundingBox().catch(() => null);
  const embed = requests.find((r) => r.host === 'www.youtube-nocookie.com' && r.path.startsWith(`/embed/${SAMPLE}`));
  const result = {
    schema_version: 1, sample_video_id: SAMPLE, sample_source: 'Google YouTube IFrame Player API reference example id',
    ran_at: new Date().toISOString(), browser: page.context().browser().version(), headless: true,
    requests_before_play: beforePlay, outcome, iframe_src: src, iframe_box: box,
    embed_referer: embed?.referer || null,
    hosts_after_play: [...new Set(requests.filter((r) => r.at >= clickedAt).map((r) => r.host))].sort(),
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
  expect(beforePlay, 'no third-party request before Play').toBe(0);
  expect(src).toMatch(new RegExp(`^https://www\\.youtube-nocookie\\.com/embed/${SAMPLE}\\?`));
  expect(embed?.referer).toBe(`${new URL(baseURL).origin}/`);
  expect(box.width).toBeGreaterThanOrEqual(200);
  expect(box.height).toBeGreaterThanOrEqual(200);
  expect(['ready', 'error', 'limited', 'timeout']).toContain(outcome.state);
});
