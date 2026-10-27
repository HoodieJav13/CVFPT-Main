// Paired before/after evidence for the residual R2 fix: with the poster crop
// open at a saved 0.5 s, the saved time is changed to 3.0 s, then the crop is
// edited by keyboard. "before" = pinned c64d17c, "after" = this tree; same
// harness, same synthetic clip, reduced motion.
// Run: CVF_R2_BEFORE_DIR=<pinned clone> npx playwright test --config playwright.exercise-media-r2-selection.config.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = path.join(ROOT, 'docs/exercise-media/p2-correction/selection-change');
const VIDEO = fs.readFileSync(path.join(import.meta.dirname, 'fixtures/exercise-media/synthetic-moving-geometry.mp4'));
const sha = (value) => createHash('sha256').update(value).digest('hex');
const records = [];

function source(variant) {
  const dir = variant === 'before' ? process.env.CVF_R2_BEFORE_DIR : ROOT;
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
  return { commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), tracked_changes: git('status', '--porcelain', '--untracked-files=no', '--', '.', ':(exclude)docs/exercise-media/p2-correction').split('\n').filter(Boolean) };
}

const drawAt = (page, ms) => page.evaluate(async (target) => {
  const el = document.querySelector('[data-testid="video-selection-video"]');
  await new Promise((resolve) => { el.addEventListener('seeked', resolve, { once: true }); el.currentTime = target / 1000; });
  const canvas = document.createElement('canvas'); canvas.width = el.videoWidth; canvas.height = el.videoHeight;
  canvas.getContext('2d').drawImage(el, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.85);
}, ms);

for (const [width, height] of [[320, 740], [390, 844], [1280, 900]]) {
  test(`saved poster time changed while its crop is open at ${width}x${height}`, async ({ page }) => {
    const variant = test.info().project.name;
    await page.setViewportSize({ width, height });
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
    await page.goto(`/e2e/harness/video-selection.html?recipe=${encodeURIComponent(JSON.stringify({ poster_mode: 'video_frame', poster_frame_ms: 500, poster_crop: { x: 0, y: 0, width: 1, height: 1 } }))}`);
    const video = page.getByTestId('video-selection-video');
    await expect.poll(() => video.evaluate((el) => el.readyState)).toBeGreaterThanOrEqual(1);
    const states = [];
    const snap = async (state) => {
      const crop = page.getByTestId('video-frame-crop');
      if (await crop.count()) await crop.scrollIntoViewIfNeeded();
      const img = page.locator('[data-testid="crop-poster"] img');
      const cropSrc = (await img.count()) ? await img.getAttribute('src') : null;
      const label = (await page.getByTestId('video-frame-target').count()) ? (await page.getByTestId('video-frame-target').textContent()).trim() : null;
      fs.mkdirSync(path.join(OUT, 'images'), { recursive: true });
      const file = `images/${state}-${variant}-${width}x${height}.png`;
      const shot = await page.screenshot({ path: path.join(OUT, file) });
      const recipe = await page.evaluate(() => window.__harness.recipe);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      states.push({ file, state, cropSrcHash: cropSrc ? sha(cropSrc) : null, label, poster_frame_ms: recipe.poster_frame_ms, poster_crop: recipe.poster_crop, horizontal_overflow: overflow, sha256: sha(shot), bytes: shot.length });
    };
    await page.getByRole('button', { name: 'Crop poster', exact: true }).click();
    await expect(page.locator('[data-testid="crop-poster"] img')).toHaveAttribute('src', /^data:image\/jpeg/);
    await snap('1-crop-open-500ms');
    const field = page.getByLabel('Poster', { exact: true });
    await field.fill('3.000');
    await field.press('Enter');
    await page.waitForTimeout(600);
    await snap('2-saved-time-changed-to-3000ms');
    const area = page.getByTestId('crop-poster-area');
    if (await area.count()) {
      await area.focus();
      for (let i = 0; i < 3; i += 1) await page.keyboard.press('+');
      await page.keyboard.press('ArrowRight');
    }
    await snap('3-keyboard-crop-edit');
    const frame500 = sha(await drawAt(page, 500));
    const frame3000 = sha(await drawAt(page, 3000));
    for (const row of states) {
      records.push({
        ...row, variant, viewport: { width, height },
        crop_shows: row.cropSrcHash === frame500 ? 'old 500 ms frame' : row.cropSrcHash === frame3000 ? 'new 3000 ms frame' : row.cropSrcHash ? 'other' : 'no crop image',
        source: source(variant),
      });
    }
  });
}

test.afterAll(() => {
  if (!records.length) return;
  const file = path.join(OUT, 'capture-records.json');
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const keep = existing.filter((row) => !records.some((next) => next.file === row.file));
  const all = [...keep, ...records].sort((a, b) => a.file.localeCompare(b.file));
  fs.writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`);
});
