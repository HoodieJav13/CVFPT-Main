// Paired before/after evidence for the P2 frame-selection correction: the same
// harness state (saved poster 0.5 s / end still 3.5 s, scrubbed elsewhere,
// then Crop) rendered by the pinned candidate (project "before") and by this
// tree ("after"). Records which frame the crop editor shows.
// Run: CVF_P2_BEFORE_DIR=<pinned clone> npx playwright test --config playwright.exercise-media-p2-frame.config.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'docs/exercise-media/p2-correction/frame-selection');
const VIDEO = fs.readFileSync(path.join(import.meta.dirname, 'fixtures/exercise-media/synthetic-moving-geometry.mp4'));
const FULL = { x: 0, y: 0, width: 1, height: 1 };
const sha = (value) => createHash('sha256').update(value).digest('hex');
const records = [];

function source(variant) {
  const dir = variant === 'before' ? process.env.CVF_P2_BEFORE_DIR : ROOT;
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
  return { commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), tracked_changes: git('status', '--porcelain', '--untracked-files=no', '--', '.', ':(exclude)docs/exercise-media/p2-correction').split('\n').filter(Boolean) };
}

async function open(page, recipe) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/__media-fixture/**', (route) => {
    const range = /^bytes=(\d*)-(\d*)$/.exec(route.request().headers().range || '');
    if (range && range[1] !== '') {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), VIDEO.length - 1) : VIDEO.length - 1;
      return route.fulfill({ status: 206, contentType: 'video/mp4', body: VIDEO.subarray(start, end + 1), headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${VIDEO.length}` } });
    }
    return route.fulfill({ status: 200, contentType: 'video/mp4', body: VIDEO, headers: { 'accept-ranges': 'bytes' } });
  });
  await page.goto(`/e2e/harness/video-selection.html?recipe=${encodeURIComponent(JSON.stringify(recipe))}`);
  const video = page.getByTestId('video-selection-video');
  await expect.poll(() => video.evaluate((el) => el.readyState)).toBeGreaterThanOrEqual(1);
  return video;
}

const draw = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-testid="video-selection-video"]');
  const canvas = document.createElement('canvas'); canvas.width = el.videoWidth; canvas.height = el.videoHeight;
  canvas.getContext('2d').drawImage(el, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.85);
});
const drawAt = (page, ms) => page.evaluate(async (target) => {
  const el = document.querySelector('[data-testid="video-selection-video"]');
  await new Promise((resolve) => { el.addEventListener('seeked', resolve, { once: true }); el.currentTime = target / 1000; });
  const canvas = document.createElement('canvas'); canvas.width = el.videoWidth; canvas.height = el.videoHeight;
  canvas.getContext('2d').drawImage(el, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.85);
}, ms);

const CASES = [
  { state: 'poster-crop', button: 'Crop poster', testId: 'crop-poster', savedMs: 500, scrubMs: 3000, recipe: { poster_mode: 'video_frame', poster_frame_ms: 500, poster_crop: FULL } },
  { state: 'end-still-crop', button: 'Crop end still', testId: 'crop-end', savedMs: 3500, scrubMs: 1000, recipe: { poster_mode: 'video_frame', poster_frame_ms: 500, poster_crop: FULL, end_frame_ms: 3500, end_frame_crop: FULL } },
];

for (const [width, height] of [[390, 844], [1280, 900]]) {
  for (const item of CASES) {
    test(`${item.state} at ${width}x${height}`, async ({ page }) => {
      const variant = test.info().project.name;
      await page.setViewportSize({ width, height });
      const video = await open(page, item.recipe);
      await page.getByTestId('video-selection-scrub').fill(String(item.scrubMs));
      await expect.poll(() => video.evaluate((el, ms) => !el.seeking && Math.abs(el.currentTime * 1000 - ms) < 50 && el.readyState >= 2, item.scrubMs)).toBe(true);
      const scrubFrame = sha(await draw(page));
      await page.getByRole('button', { name: item.button, exact: true }).click();
      const img = page.getByTestId(item.testId).locator('img');
      await expect(img).toHaveAttribute('src', /^data:image\/jpeg/);
      const cropFrame = sha(await img.getAttribute('src'));
      await page.getByTestId('video-frame-crop').scrollIntoViewIfNeeded();
      fs.mkdirSync(path.join(OUT, 'images'), { recursive: true });
      const file = `images/${item.state}-${variant}-${width}x${height}.png`;
      const shot = await page.screenshot({ path: path.join(OUT, file) });
      const savedFrame = sha(await drawAt(page, item.savedMs));
      const recipe = await page.evaluate(() => window.__harness.recipe);
      records.push({
        file, state: item.state, variant, viewport: { width, height }, sha256: sha(shot), bytes: shot.length,
        saved_ms: item.savedMs, scrub_ms: item.scrubMs,
        crop_shows: cropFrame === savedFrame ? 'saved frame' : cropFrame === scrubFrame ? 'scrub-position frame' : 'other',
        saved_time_unchanged: (item.state === 'poster-crop' ? recipe.poster_frame_ms : recipe.end_frame_ms) === item.savedMs,
        source: source(variant),
      });
    });
  }
}

test.afterAll(() => {
  if (!records.length) return;
  const file = path.join(OUT, 'capture-records.json');
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const keep = existing.filter((row) => !records.some((next) => next.file === row.file));
  fs.writeFileSync(file, `${JSON.stringify([...keep, ...records].sort((a, b) => a.file.localeCompare(b.file)), null, 2)}\n`);
});
