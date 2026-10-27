// Default exercise guides (photos + pasted YouTube links) in the real frontend
// against REAL local services started by the owned photos launcher: disposable
// DB, PostgREST, fictional loopback auth and the real API with the in-process
// image processor. NO worker or FFmpeg container. YouTube hosts are routed to a
// deterministic stub here; the separate provider proof covers the real player.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

const ROOT = path.resolve(import.meta.dirname, '../..');
const runtime = () => JSON.parse(fs.readFileSync(path.join(ROOT, '.exercise-media-local/run/runtime.json'), 'utf8'));
const fixture = (name) => path.join(ROOT, runtime().fixtures, name);
const PROVIDER = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|ytimg\.com|googlevideo\.com|google\.com|gstatic\.com)$/;
const IFRAME_API_SHIM = `window.__yt = { players: 0, destroyed: 0 };
window.YT = { Player: function (el, opts) { window.__yt.players += 1; this.destroy = () => { window.__yt.destroyed += 1; }; this.pauseVideo = () => {};
  setTimeout(() => opts.events && opts.events.onReady && opts.events.onReady({ target: this }), 20); } };
if (typeof window.onYouTubeIframeAPIReady === 'function') window.onYouTubeIframeAPIReady();`;

async function signIn(page, account) {
  await page.goto('/__media-demo');
  await expect(page.getByRole('heading', { name: 'Synthetic local demo' })).toBeVisible();
  await page.getByTestId(`demo-login-${account}`).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/__media-demo'));
}

async function watch(page) {
  const seen = { provider: [], staging: [], external: [], consoleErrors: [] };
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (PROVIDER.test(url.hostname)) seen.provider.push(url.href);
    else if (!['127.0.0.1', 'localhost'].includes(url.hostname) && url.protocol.startsWith('http')) seen.external.push(url.origin);
    if (url.pathname.startsWith('/api/exercise-media/staging/')) seen.staging.push({ method: request.method(), type: request.headers()['content-type'] });
  });
  page.on('console', (message) => { if (message.type() === 'error') seen.consoleErrors.push(message.text()); });
  await page.route((url) => PROVIDER.test(url.hostname), (route) => {
    const url = new URL(route.request().url());
    if (url.href === 'https://www.youtube.com/iframe_api') return route.fulfill({ status: 200, contentType: 'text/javascript', body: IFRAME_API_SHIM });
    if (url.hostname === 'www.youtube-nocookie.com') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>synthetic embed stub</title>' });
    return route.abort('blockedbyclient');
  });
  return seen;
}

test('coach: a photo guide uploads through the direct grant, processes inline (no worker), and publishes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const seen = await watch(page);
  expect(runtime().mode).toBe('photos');
  expect(Object.keys(runtime().children)).toEqual(['api']);
  await signIn(page, 'coach-a');
  await page.goto('/coach/programs');
  await page.getByTestId('exercise-library-card').filter({ hasText: 'Synthetic Wall Sit' }).getByTestId('exercise-library-media-button').click();
  const editor = page.getByTestId('exercise-media-editor');
  await expect(editor.getByTestId('media-none')).toBeVisible();
  await editor.getByTestId('media-confirm-identity').click();
  await editor.getByTestId('media-new-draft').click();
  await expect(editor.getByTestId('media-upload-source_video')).toHaveCount(0);
  await editor.getByTestId('media-file-source_image').setInputFiles(fixture('goblet-squat-photo.webp'));
  await editor.getByTestId('media-rights-confirm-source_image').click();
  await editor.getByTestId('media-upload-start-source_image').click();
  await expect(editor.getByTestId('media-source-facts')).toContainText('Image 1280×720');
  expect(seen.staging).toEqual([{ method: 'PUT', type: 'image/webp' }]);
  await editor.getByTestId('media-alt-text').fill('Synthetic test photo for the wall sit identity (not instruction)');
  await editor.getByTestId('media-cue-0').fill('Synthetic cue: back flat');
  await editor.getByTestId('media-save').click();
  await editor.getByTestId('media-process').click();
  await expect(editor.getByTestId('media-draft-editor')).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
  await expect.poll(() => editor.getByTestId('review-poster').evaluate((img) => img.complete && img.naturalWidth)).toBe(640);
  for (const id of ['attest-variant', 'attest-rights', 'attest-content']) await editor.getByTestId(id).click();
  await editor.getByTestId('media-approve').click();
  await editor.getByTestId('media-publish').click();
  await expect(page.getByText(/Published\. Every workout/)).toBeVisible();
  expect(seen.provider).toEqual([]);
  expect(seen.external).toEqual([]);
});

test('coach: the workout editor shows library demo, custom link and legacy states; choosing the library demo keeps it live', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const seen = await watch(page);
  await signIn(page, 'coach-a');
  await page.goto('/coach/programs');
  await page.getByTestId('training-builder-tab-workouts').click();
  await page.getByTestId('workout-card').filter({ hasText: 'Synthetic guides session' }).getByTestId('workout-edit-button').click();
  const rows = page.getByTestId('workout-exercise-row');
  // The first row starts expanded; expand others only when collapsed.
  const open = async (index) => {
    const trigger = rows.nth(index).locator('h3 button');
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
    return rows.nth(index).getByTestId('workout-exercise-demo');
  };
  await expect(await open(0)).toHaveAttribute('data-demo-choice', 'library');
  await expect(rows.nth(0).getByTestId('workout-exercise-demo')).toContainText('YouTube demo, plays in the app on request');
  const band = await open(2);
  await expect(band).toHaveAttribute('data-demo-choice', 'custom');
  await expect(band.getByTestId('workout-exercise-video-input')).toHaveValue('https://example.com/synthetic-coach-override');
  // The unclassified legacy row with no link reads as the library demo without being reclassified.
  await expect(await open(4)).toHaveAttribute('data-demo-choice', 'library');
  await band.getByTestId('workout-exercise-demo-library').check();
  await expect(band).toHaveAttribute('data-demo-choice', 'library');
  await expect(band.getByTestId('workout-exercise-video-input')).toHaveCount(0);
  await page.getByTestId('workout-save-button').click();
  await expect(page.getByText('Workout updated')).toBeVisible();
  expect(seen.provider).toEqual([]);
});

test('client: photo and cues inline, a click-to-load demo with first-party facade, external links, and logging still works', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const seen = await watch(page);
  await signIn(page, 'client-1');
  await page.goto('/client/programs?view=other');
  await page.getByTestId('client-workout-assignment-card').filter({ hasText: 'Synthetic guides session' }).getByTestId('start-standalone-workout').click();
  await expect(page).toHaveURL(/\/client\/workouts\/[^/]+\/track$/);
  const cards = page.getByTestId('tracker-exercise-card');
  await expect(cards.nth(0).getByTestId('exercise-media-poster')).toBeVisible();
  await expect(cards.nth(0)).toContainText('Synthetic cue: chest tall');
  await page.waitForTimeout(300);
  expect(seen.provider, 'no provider traffic before Play').toEqual([]);
  await cards.nth(0).getByTestId('tracker-exercise-demo').click();
  const dialog = page.getByTestId('exercise-demo-dialog');
  await expect(dialog.getByTestId('exercise-demo-poster')).toBeVisible();
  await expect.poll(() => dialog.getByTestId('exercise-demo-poster').evaluate((img) => img.complete && img.naturalWidth)).toBe(640);
  expect(seen.provider).toEqual([]);
  await dialog.getByTestId('exercise-demo-play').click();
  await expect(dialog.getByTestId('exercise-demo-iframe')).toHaveAttribute('src', /^https:\/\/www\.youtube-nocookie\.com\/embed\/SYNTHdemo01\?/);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
  // The client's assignment is a private copy (copy-on-assign): the template edit
  // above leaves its explicit override alone. Generic links stay external links.
  await expect(cards.nth(2).getByTestId('tracker-exercise-video')).toHaveAttribute('href', 'https://example.com/synthetic-coach-override');
  await expect(cards.nth(2).getByTestId('tracker-exercise-demo')).toHaveCount(0);
  const weight = cards.nth(0).getByLabel('Synthetic Goblet Squat set 1 weight', { exact: true });
  await weight.fill('16');
  await weight.blur();
  await expect(page.getByText(/Saved|All changes saved/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Finish workout/ })).toBeVisible();
  expect(seen.external).toEqual([]);
});
