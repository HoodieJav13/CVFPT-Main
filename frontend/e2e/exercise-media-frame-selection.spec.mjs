// Frame-selection regression (P2 correction R2), run by test:e2e:media against
// the real VideoSelectionEditor mounted in a test-only harness page. Each crop
// target must show the frame at ITS saved time (poster_frame_ms,
// end_frame_ms, the preview's selected start), never the current scrub
// position, in the browser and in the server fallback; late or failed
// captures must never leave stale or wrong imagery in the crop editor.
// Video: labelled synthetic moving geometry (e2e/fixtures/exercise-media).
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';

test.setTimeout(60_000);

const VIDEO = fs.readFileSync(new URL('./fixtures/exercise-media/synthetic-moving-geometry.mp4', import.meta.url));
const FULL = { x: 0, y: 0, width: 1, height: 1 };
// Frames are compared as short hashes of identical-encoder data URLs.
const h = (dataUrl) => createHash('sha256').update(String(dataUrl)).digest('hex').slice(0, 16);

// Solid-colour PNG, so server-rendered frames are distinguishable by pixel.
function png([r, g, b], size = 16) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(zlib.crc32(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, Buffer.from([r, g, b]))]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(size).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}
const RED = [220, 30, 30];
const BLUE = [30, 60, 220];
const GREEN = [30, 180, 60];

// frames: { [timeMs]: { color, delayMs, status } } for the server fallback.
async function openHarness(page, { recipe, video = 'valid', frames = {} } = {}) {
  const calls = { frames: [], videoRequests: 0 };
  await page.route('**/__media-fixture/**', async (route) => {
    calls.videoRequests += 1;
    if (video === 'broken') return route.fulfill({ status: 200, contentType: 'video/mp4', body: 'not a decodable video' });
    const range = /^bytes=(\d*)-(\d*)$/.exec(route.request().headers().range || '');
    if (range && range[1] !== '') {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), VIDEO.length - 1) : VIDEO.length - 1;
      return route.fulfill({ status: 206, contentType: 'video/mp4', body: VIDEO.subarray(start, end + 1), headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${VIDEO.length}` } });
    }
    return route.fulfill({ status: 200, contentType: 'video/mp4', body: VIDEO, headers: { 'accept-ranges': 'bytes' } });
  });
  await page.route('**/__media-frame*', async (route) => {
    const ms = Number(new URL(route.request().url()).searchParams.get('time_ms'));
    calls.frames.push(ms);
    const spec = frames[ms] || { color: GREEN };
    if (spec.delayMs) await new Promise((resolve) => setTimeout(resolve, spec.delayMs));
    if (spec.status && spec.status !== 200) return route.fulfill({ status: spec.status, contentType: 'application/json', body: '{"code":"processor_unavailable"}' });
    return route.fulfill({ status: 200, contentType: 'image/png', body: png(spec.color) });
  });
  await page.goto(`/e2e/harness/video-selection.html?recipe=${encodeURIComponent(JSON.stringify(recipe))}`);
  await expect(page.getByTestId('video-selection-editor')).toBeVisible();
  return calls;
}

const video = (page) => page.getByTestId('video-selection-video');
const recipeOf = (page) => page.evaluate(() => window.__harness.recipe);

async function readyToScrub(page) {
  await expect.poll(() => video(page).evaluate((el) => el.readyState)).toBeGreaterThanOrEqual(1);
}

// Scrub through the component's own position control and wait for the frame.
async function scrubTo(page, ms) {
  await page.getByTestId('video-selection-scrub').fill(String(ms));
  await expect.poll(() => video(page).evaluate((el) => el.currentTime)).toBeCloseTo(ms / 1000, 1);
  await expect.poll(() => video(page).evaluate((el) => !el.seeking && el.readyState >= 2)).toBe(true);
}

// Independent reference: the frame the same element shows at `ms`.
function frameAt(page, ms) {
  return page.evaluate(async (target) => {
    const el = document.querySelector('[data-testid="video-selection-video"]');
    await new Promise((resolve) => { el.addEventListener('seeked', resolve, { once: true }); el.currentTime = target / 1000; });
    const canvas = document.createElement('canvas');
    canvas.width = el.videoWidth; canvas.height = el.videoHeight;
    canvas.getContext('2d').drawImage(el, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.85);
  }, ms);
}

const currentFrame = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-testid="video-selection-video"]');
  const canvas = document.createElement('canvas');
  canvas.width = el.videoWidth; canvas.height = el.videoHeight;
  canvas.getContext('2d').drawImage(el, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.85);
});

// Average colour of the crop editor's image (server fallback frames are solid).
function cropColor(page, testId) {
  return page.evaluate(async (id) => {
    const img = document.querySelector(`[data-testid="${id}"] img`);
    if (!img.complete) await new Promise((resolve) => { img.onload = resolve; });
    const canvas = document.createElement('canvas');
    canvas.width = 4; canvas.height = 4;
    const g = canvas.getContext('2d');
    g.drawImage(img, 0, 0, 4, 4);
    const [r, gg, b] = g.getImageData(1, 1, 1, 1).data;
    return [r, gg, b];
  }, testId);
}
const near = (actual, expected) => actual.every((value, i) => Math.abs(value - expected[i]) <= 12);

test('poster crop shows the saved poster frame after unrelated scrubbing; the saved time is unchanged', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  const calls = await openHarness(page, { recipe: { poster_mode: 'video_frame', poster_frame_ms: 500, poster_crop: FULL } });
  await readyToScrub(page);
  await scrubTo(page, 3000);
  const scrubFrame = h(await currentFrame(page));
  await page.getByRole('button', { name: 'Crop poster', exact: true }).click();
  const img = page.getByTestId('crop-poster').locator('img');
  await expect(img).toHaveAttribute('src', /^data:image\/jpeg/);
  const cropSrc = h(await img.getAttribute('src'));
  expect(await video(page).evaluate((el) => el.paused)).toBe(true);
  const selected = h(await frameAt(page, 500));
  expect(selected).not.toBe(scrubFrame); // precondition: the two frames differ
  expect(cropSrc).toBe(selected);
  expect(cropSrc).not.toBe(scrubFrame);
  expect((await recipeOf(page)).poster_frame_ms).toBe(500);
  expect(calls.frames).toEqual([]);
});

test('end-still crop shows the saved end frame after unrelated scrubbing', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await openHarness(page, { recipe: { poster_mode: 'video_frame', poster_frame_ms: 500, poster_crop: FULL, end_frame_ms: 3500, end_frame_crop: FULL } });
  await readyToScrub(page);
  await scrubTo(page, 1000);
  const scrubFrame = h(await currentFrame(page));
  await page.getByRole('button', { name: 'Crop end still', exact: true }).click();
  const img = page.getByTestId('crop-end').locator('img');
  await expect(img).toHaveAttribute('src', /^data:image\/jpeg/);
  const cropSrc = h(await img.getAttribute('src'));
  const selected = h(await frameAt(page, 3500));
  expect(selected).not.toBe(scrubFrame);
  expect(cropSrc).toBe(selected);
  expect((await recipeOf(page)).end_frame_ms).toBe(3500);
});

test('preview crop uses the selected segment start, not the scrub position', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await openHarness(page, { recipe: { preview_start_ms: 1000, preview_end_ms: 3000, preview_crop: FULL } });
  await readyToScrub(page);
  await scrubTo(page, 3500);
  const scrubFrame = h(await currentFrame(page));
  await page.getByRole('button', { name: 'Crop preview', exact: true }).click();
  const img = page.getByTestId('crop-preview').locator('img');
  await expect(img).toHaveAttribute('src', /^data:image\/jpeg/);
  await expect(page.getByTestId('video-frame-target')).toContainText('0:01.0');
  const cropSrc = h(await img.getAttribute('src'));
  const selected = h(await frameAt(page, 1000));
  expect(selected).not.toBe(scrubFrame);
  expect(cropSrc).toBe(selected);
  expect(await recipeOf(page)).toMatchObject({ preview_start_ms: 1000, preview_end_ms: 3000 });
});

test('server fallback requests each target\'s saved time; Show frame previews the position without cropping', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  const calls = await openHarness(page, {
    video: 'broken',
    recipe: { poster_mode: 'video_frame', poster_frame_ms: 500, poster_crop: FULL, end_frame_ms: 3500, end_frame_crop: FULL },
    frames: { 500: { color: RED }, 3500: { color: BLUE }, 2000: { color: GREEN } },
  });
  await expect(page.getByTestId('video-undecodable')).toBeVisible();
  await page.getByTestId('video-selection-scrub').fill('2000');
  await page.getByRole('button', { name: 'Crop poster', exact: true }).click();
  await expect(page.getByTestId('crop-poster').locator('img')).toBeVisible();
  expect(near(await cropColor(page, 'crop-poster'), RED)).toBe(true);
  await page.getByRole('button', { name: 'Crop end still', exact: true }).click();
  await expect(page.getByTestId('crop-end').locator('img')).toBeVisible();
  expect(near(await cropColor(page, 'crop-end'), BLUE)).toBe(true);
  expect(calls.frames).toEqual([500, 3500]);
  await page.getByRole('button', { name: 'Show frame', exact: true }).click();
  await expect(page.getByTestId('video-position-frame')).toBeVisible();
  expect(calls.frames).toEqual([500, 3500, 2000]);
  expect(await recipeOf(page)).toMatchObject({ poster_frame_ms: 500, end_frame_ms: 3500 });
});

test('a slow capture never replaces a newer target, and a source change discards a pending capture', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await openHarness(page, {
    video: 'broken',
    recipe: { poster_mode: 'video_frame', poster_frame_ms: 500, poster_crop: FULL, end_frame_ms: 3500, end_frame_crop: FULL },
    frames: { 500: { color: RED, delayMs: 1500 }, 3500: { color: BLUE } },
  });
  await expect(page.getByTestId('video-undecodable')).toBeVisible();
  await page.getByRole('button', { name: 'Crop poster', exact: true }).click();
  await expect(page.getByTestId('video-frame-loading')).toBeVisible();
  await expect(page.getByTestId('crop-poster')).toHaveCount(0); // nothing to crop while loading
  await page.getByRole('button', { name: 'Crop end still', exact: true }).click();
  await expect(page.getByTestId('crop-end').locator('img')).toBeVisible();
  await page.waitForTimeout(2000); // the slow poster response has landed by now
  await expect(page.getByTestId('crop-poster')).toHaveCount(0);
  expect(near(await cropColor(page, 'crop-end'), BLUE)).toBe(true);

  // A pending capture for the old source is dropped when the source changes.
  await page.getByRole('button', { name: 'Crop poster', exact: true }).click();
  await expect(page.getByTestId('video-frame-loading')).toBeVisible();
  await page.evaluate(() => window.__harness.setSrc('/__media-fixture/replacement.mp4'));
  await page.waitForTimeout(2000);
  await expect(page.getByTestId('crop-poster')).toHaveCount(0);
  await expect(page.getByTestId('video-frame-crop')).toHaveCount(0);
});

test('a failed capture shows a recoverable message instead of stale crop content', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  const frames = { 500: { status: 503 } };
  await openHarness(page, { video: 'broken', recipe: { poster_mode: 'video_frame', poster_frame_ms: 500, poster_crop: FULL }, frames });
  await expect(page.getByTestId('video-undecodable')).toBeVisible();
  await page.getByRole('button', { name: 'Crop poster', exact: true }).click();
  await expect(page.getByTestId('video-frame-error')).toBeVisible();
  await expect(page.getByTestId('crop-poster')).toHaveCount(0);
  frames[500] = { color: RED };
  await page.getByTestId('video-frame-error').getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByTestId('crop-poster').locator('img')).toBeVisible();
  expect(near(await cropColor(page, 'crop-poster'), RED)).toBe(true);
});

for (const [width, height] of [[320, 740], [390, 844], [1280, 900]]) {
  test(`keyboard: scrub, exact times and crop controls work without overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openHarness(page, { recipe: { poster_mode: 'video_frame', poster_frame_ms: 500, poster_crop: FULL } });
    await readyToScrub(page);
    const scrub = page.getByTestId('video-selection-scrub');
    await scrub.focus();
    await page.keyboard.press('End');
    await expect(page.getByTestId('video-selection-time')).toContainText('0:03.9');
    const posterField = page.getByLabel('Poster', { exact: true });
    await posterField.fill('1.25');
    await posterField.press('Enter');
    await expect.poll(async () => (await recipeOf(page)).poster_frame_ms).toBe(1250);
    const cropButton = page.getByRole('button', { name: 'Crop poster', exact: true });
    await cropButton.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('crop-poster').locator('img')).toHaveAttribute('src', /^data:image\/jpeg/);
    await expect(page.getByTestId('video-frame-target')).toContainText('0:01.2');
    const area = page.getByTestId('crop-poster-area');
    await area.focus();
    await page.keyboard.press('+');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await recipeOf(page)).poster_crop.width).toBeLessThan(1);
    expect((await recipeOf(page)).poster_frame_ms).toBe(1250);
    await page.getByTestId('video-frame-crop').getByRole('button', { name: 'Done' }).click();
    await expect(cropButton).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await video(page).evaluate((el) => el.paused && !el.autoplay)).toBe(true);
  });
}
