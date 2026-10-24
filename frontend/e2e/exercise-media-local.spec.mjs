// Exercise media in the real frontend against REAL local services (owned
// launcher: disposable DB, PostgREST, fictional loopback auth, real API, real
// FFmpeg worker). Synthetic accounts and media only; nothing hosted.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

const ROOT = path.resolve(import.meta.dirname, '../..');
const runtime = () => JSON.parse(fs.readFileSync(path.join(ROOT, '.exercise-media-local/run/runtime.json'), 'utf8'));
const fixture = (name) => path.join(ROOT, runtime().fixtures, name);
const FINDINGS = path.join(ROOT, '.exercise-media-local/evidence/browser-local-network.json');

async function signIn(page, account) {
  await page.goto('/__media-demo');
  await expect(page.getByRole('heading', { name: 'Synthetic local demo' })).toBeVisible();
  await page.getByTestId(`demo-login-${account}`).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/__media-demo'));
}

function watch(page) {
  const seen = { content: [], external: [], consoleErrors: [], bytes: new Map() };
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) && !url.protocol.startsWith('data') && !url.protocol.startsWith('blob')) seen.external.push(url.origin);
    if (url.pathname.startsWith('/api/exercise-media/content/')) seen.content.push(request);
  });
  page.on('response', async (response) => {
    if (new URL(response.url()).pathname.startsWith('/api/exercise-media/content/')) {
      const length = Number(response.headers()['content-length'] || 0);
      seen.bytes.set(response.url(), { type: response.headers()['content-type'], length, status: response.status() });
    }
  });
  page.on('console', (message) => { if (message.type() === 'error') seen.consoleErrors.push(message.text()); });
  return seen;
}

async function openMedia(page, exerciseName) {
  await page.goto('/coach/programs');
  const card = page.getByTestId('exercise-library-card').filter({ hasText: exerciseName });
  await card.getByTestId('exercise-library-media-button').click();
  const editor = page.getByTestId('exercise-media-editor');
  await expect(editor.getByTestId('media-exact-identity')).toContainText(exerciseName);
  return editor;
}

async function approveAndPublish(page, editor) {
  await expect(editor.getByTestId('media-draft-editor')).toHaveAttribute('data-status', 'ready', { timeout: 180_000 });
  await expect(editor.getByTestId('review-poster')).toBeVisible();
  await expect.poll(() => editor.getByTestId('review-poster').evaluate((img) => img.complete && img.naturalWidth)).toBe(640);
  for (const id of ['attest-variant', 'attest-rights', 'attest-content']) await editor.getByTestId(id).click();
  await editor.getByTestId('media-approve').click();
  await editor.getByTestId('media-publish').click();
  await expect(page.getByText(/Published\. Every workout/)).toBeVisible();
}

test('coach: image-only upload, keyboard crop, real processing, explicit review and publish', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const seen = watch(page);
  await signIn(page, 'coach-a');
  const editor = await openMedia(page, 'Synthetic Goblet Squat');
  await expect(editor.getByTestId('media-none')).toBeVisible();
  await editor.getByTestId('media-confirm-identity').click();
  await editor.getByTestId('media-new-draft').click();
  await editor.getByTestId('media-file-source_image').setInputFiles(fixture('goblet-squat-photo.jpg'));
  await editor.getByTestId('media-rights-confirm-source_image').click();
  await editor.getByTestId('media-upload-start-source_image').click();
  await expect(editor.getByTestId('media-source-facts')).toContainText('Image 1600×900');
  const area = editor.getByTestId('poster-crop-area');
  await area.focus();
  await page.keyboard.press('+');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(editor.getByTestId('poster-crop-readout')).not.toContainText('1600×900 px from (0, 0)');
  await page.keyboard.press('0');
  await expect(editor.getByTestId('poster-crop-readout')).toContainText('1600×900 px from (0, 0)');
  await editor.getByTestId('media-alt-text').fill('Synthetic test photo for the goblet squat identity');
  await editor.getByTestId('media-cue-0').fill('Synthetic cue one');
  await editor.getByTestId('media-save').click();
  await expect(editor.getByTestId('media-process')).toBeEnabled();
  await editor.getByTestId('media-process').click();
  await approveAndPublish(page, editor);
  expect(seen.external).toEqual([]);
});

test('client: inline guides load only active+next posters, preview on tap, separate full instruction', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const seen = watch(page);
  await signIn(page, 'client-1');
  const card = page.getByTestId('client-workout-assignment-card').filter({ hasText: 'Synthetic media session' });
  await card.getByTestId('start-standalone-workout').click();
  await expect(page).toHaveURL(/\/track$/);
  const cards = page.getByTestId('tracker-exercise-card');
  await expect(cards.nth(0).getByTestId('exercise-media-poster')).toBeVisible();
  await expect(cards.nth(1).getByTestId('exercise-media-poster')).toBeVisible();
  await expect.poll(() => cards.nth(0).getByTestId('exercise-media-poster').evaluate((img) => img.complete && img.naturalWidth)).toBe(640);
  await page.waitForTimeout(1000);
  const initial = [...seen.bytes.values()];
  expect(seen.content.length).toBe(2);
  expect(initial.every((entry) => entry.type === 'image/jpeg' && entry.status === 200)).toBe(true);
  const posterBytes = initial.reduce((sum, entry) => sum + entry.length, 0);
  expect(posterBytes).toBeLessThanOrEqual(400 * 1024);
  expect(seen.content.filter((request) => request.resourceType() === 'media').length).toBe(0);
  // Band row: load on request, then explicit preview playback (real MP4).
  await cards.nth(2).getByRole('button', { name: /Show movement preview/ }).click();
  await cards.nth(2).getByTestId('exercise-media-play').click();
  const video = cards.nth(2).getByTestId('exercise-media-preview');
  await expect.poll(() => video.evaluate((el) => el.readyState), { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
  expect(await video.evaluate((el) => ({ muted: el.muted, loop: el.loop }))).toEqual({ muted: true, loop: false });
  const previewEntry = [...seen.bytes.entries()].find(([, entry]) => entry.type === 'video/mp4');
  expect(previewEntry).toBeTruthy();
  // Full instruction is separate: real video, captions track, transcript.
  await cards.nth(2).getByTestId('exercise-media-instruction').click();
  const dialog = page.getByTestId('exercise-instruction-dialog');
  const instruction = dialog.getByTestId('exercise-instruction-video');
  await expect.poll(() => instruction.evaluate((el) => el.readyState), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  expect(await instruction.evaluate((el) => el.textTracks.length)).toBe(1);
  await dialog.getByTestId('exercise-instruction-captions').click();
  await expect.poll(() => instruction.evaluate((el) => el.textTracks[0].mode)).toBe('showing');
  await dialog.getByTestId('exercise-instruction-transcript').click();
  await expect(dialog.getByTestId('exercise-instruction-transcript-text')).toContainText('Synthetic transcript');
  await page.keyboard.press('Escape');
  await expect(cards.nth(2).getByTestId('exercise-media-instruction')).toBeFocused();
  // Logging is unaffected; complete a goblet set so history exists.
  await cards.nth(0).getByRole('spinbutton', { name: /set 1 weight/ }).fill('20');
  await cards.nth(0).getByRole('button', { name: 'Complete set 1' }).click();
  await expect(page.getByTestId('workout-save-state')).toContainText('Saved');
  fs.mkdirSync(path.dirname(FINDINGS), { recursive: true });
  fs.writeFileSync(FINDINGS, `${JSON.stringify({ initial_content_requests: initial.length, initial_poster_bytes: posterBytes, preview: previewEntry?.[1] || null, external_origins: seen.external }, null, 2)}\n`);
  expect(seen.external).toEqual([]);
  expect(seen.consoleErrors.filter((text) => !/favicon|DevTools/.test(text))).toEqual([]);
});

test('coach: add video to the current photo (same exercise), scrub by keyboard, publish; client sees the update', async ({ page, browser }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, 'coach-a');
  const editor = await openMedia(page, 'Synthetic Goblet Squat');
  await expect(editor.getByTestId('media-current')).toBeVisible();
  await editor.getByTestId('media-new-from-current').click();
  await expect(editor.getByTestId('media-source-facts')).toContainText('kept from current guide');
  await editor.getByTestId('media-file-source_video').setInputFiles(fixture('goblet-squat-replacement.mp4'));
  await editor.getByTestId('media-rights-confirm-source_video').click();
  await editor.getByTestId('media-upload-start-source_video').click();
  await expect(editor.getByTestId('media-source-facts')).toContainText('Video 1280×720');
  const scrub = editor.getByTestId('video-selection-scrub');
  await expect(editor.getByTestId('video-selection-video')).toBeVisible();
  await scrub.focus();
  await page.keyboard.press('Home');
  await editor.getByTestId('set-preview-in').click();
  await expect(editor.getByTestId('preview-range')).toContainText('0:00.0 → 0:02.0');
  await expect(editor.getByTestId('preview-error')).toHaveCount(0);
  await editor.getByTestId('media-save').click();
  await editor.getByTestId('media-process').click();
  await approveAndPublish(page, editor);
  // The client's existing in-progress workout now shows the new guide.
  const client = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await signIn(client, 'client-1');
  await client.goto('/client/programs?view=other');
  await client.getByTestId('client-workout-assignment-card').filter({ hasText: 'Synthetic media session' }).getByTestId('start-standalone-workout').click();
  const goblet = client.getByTestId('tracker-exercise-card').first();
  await expect(goblet.getByTestId('exercise-media-play')).toBeVisible();
  await expect(goblet.getByRole('spinbutton', { name: /set 1 weight/ })).toHaveValue('20');
  await client.close();
});

test('coach B sees the current guide but cannot withdraw or silently replace coach A\'s', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, 'coach-b');
  const editor = await openMedia(page, 'Synthetic Goblet Squat');
  await expect(editor.getByTestId('media-current')).toContainText('Published by Synthetic Coach Avery');
  await expect(editor.getByTestId('media-withdraw')).toHaveCount(0);
  await expect(editor.getByTestId('media-draft-chip')).toHaveCount(0, { timeout: 5_000 });
});

// P2 correction R2 through the real upload → FFmpeg worker path: the poster and
// end still are cropped on their SAVED frames even after unrelated scrubbing,
// and the generated outputs show that same movement phase (compared at 64×36
// with a JPEG/scaling tolerance; the scrub-position frame is the control).
const FRAME_EVIDENCE = path.join(ROOT, '.exercise-media-local/evidence/p2-correction/real-frame-selection.json');

async function cropOnTarget(page, editor, { button, testId, label }) {
  await editor.getByRole('button', { name: button, exact: true }).click();
  const img = editor.getByTestId(testId).locator('img');
  await expect(img).toHaveAttribute('src', /^data:image\/jpeg/);
  await expect(editor.getByTestId('video-frame-target')).toContainText(label);
  const area = editor.getByTestId(`${testId}-area`);
  await area.focus();
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('+');
  await page.keyboard.press('Shift+ArrowLeft');
  const readout = await editor.getByTestId(`${testId}-readout`).textContent();
  const [, width, height, x, y] = readout.match(/(\d+)×(\d+) px from \((\d+), (\d+)\)/).map(Number);
  const viewSrc = await img.getAttribute('src'); // the frame the coach is cropping
  await editor.getByTestId('video-frame-crop').getByRole('button', { name: 'Done' }).click();
  return { rect: { x, y, width, height }, viewSrc };
}

function compareOutput(page, { targetMs, controlMs, rect, viewSrc, url }) {
  return page.evaluate(async (args) => {
    const video = document.querySelector('[data-testid="video-selection-video"]');
    const W = 64; const H = 36;
    const toPixels = (source, sx, sy, sw, sh) => {
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      const g = canvas.getContext('2d'); g.imageSmoothingQuality = 'high';
      g.drawImage(source, sx, sy, sw, sh, 0, 0, W, H);
      return g.getImageData(0, 0, W, H).data;
    };
    const frame = async (ms) => {
      await new Promise((resolve) => { video.addEventListener('seeked', resolve, { once: true }); video.currentTime = ms / 1000; });
      return toPixels(video, args.rect.x, args.rect.y, args.rect.width, args.rect.height);
    };
    const blob = await (await fetch(args.url)).blob();
    const bitmap = await createImageBitmap(blob);
    const output = toPixels(bitmap, 0, 0, bitmap.width, bitmap.height);
    const meanDiff = (pixels) => {
      let sum = 0; let n = 0;
      for (let i = 0; i < pixels.length; i += 4) { for (let c = 0; c < 3; c += 1) { sum += Math.abs(pixels[i + c] - output[i + c]); n += 1; } }
      return Math.round((sum / n) * 100) / 100;
    };
    const view = new Image();
    view.src = args.viewSrc;
    await view.decode();
    const coachView = meanDiff(toPixels(view, args.rect.x, args.rect.y, args.rect.width, args.rect.height));
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))).map((b) => b.toString(16).padStart(2, '0')).join('');
    return { coachView, selected: meanDiff(await frame(args.targetMs)), scrubControl: meanDiff(await frame(args.controlMs)), output: { width: bitmap.width, height: bitmap.height, bytes: blob.size, sha256: digest } };
  }, { targetMs, controlMs, rect, viewSrc, url });
}

test('coach: poster and end still crop their saved frames after scrubbing; published outputs show the same phase', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, 'coach-a');
  const editor = await openMedia(page, 'Synthetic Wall Sit (no media)');
  await editor.getByTestId('media-confirm-identity').click();
  await editor.getByTestId('media-new-draft').click();
  await editor.getByTestId('media-file-source_video').setInputFiles(fixture('band-row.mp4'));
  await editor.getByTestId('media-rights-confirm-source_video').click();
  await editor.getByTestId('media-upload-start-source_video').click();
  await expect(editor.getByTestId('media-source-facts')).toContainText('Video 1280×720');
  const video = editor.getByTestId('video-selection-video');
  await expect.poll(() => video.evaluate((el) => el.readyState)).toBeGreaterThanOrEqual(1);
  const exact = async (label, seconds) => { const field = editor.getByLabel(label, { exact: true }); await field.fill(seconds); await field.press('Enter'); };
  await exact('Poster', '0.5');
  await exact('End still', '5');
  const scrub = async (ms) => {
    await editor.getByTestId('video-selection-scrub').fill(String(ms));
    await expect.poll(() => video.evaluate((el, target) => !el.seeking && Math.abs(el.currentTime * 1000 - target) < 50 && el.readyState >= 2, ms)).toBe(true);
  };
  await scrub(4000);
  const posterCrop = await cropOnTarget(page, editor, { button: 'Crop poster', testId: 'crop-poster', label: '0:00.5' });
  await scrub(1000);
  const endCrop = await cropOnTarget(page, editor, { button: 'Crop end still', testId: 'crop-end', label: '0:05.0' });
  await editor.getByTestId('media-alt-text').fill('Synthetic wall sit start still');
  await editor.getByLabel('End still alt text').fill('Synthetic wall sit end still');
  await editor.getByTestId('media-save').click();
  await expect(editor.getByTestId('media-process')).toBeEnabled();
  await editor.getByTestId('media-process').click();
  await expect(editor.getByTestId('media-draft-editor')).toHaveAttribute('data-status', 'ready', { timeout: 180_000 });
  const review = editor.getByTestId('media-derivative-review');
  await expect.poll(() => review.getByTestId('review-poster').evaluate((img) => img.complete && img.naturalWidth)).toBe(640);
  const posterUrl = await review.getByTestId('review-poster').getAttribute('src');
  const endUrl = await review.getByRole('img', { name: 'Synthetic wall sit end still' }).getAttribute('src');
  await expect.poll(() => video.evaluate((el) => el.readyState)).toBeGreaterThanOrEqual(1);
  const poster = await compareOutput(page, { targetMs: 500, controlMs: 4000, ...posterCrop, url: posterUrl });
  const end = await compareOutput(page, { targetMs: 5000, controlMs: 1000, ...endCrop, url: endUrl });
  fs.mkdirSync(path.dirname(FRAME_EVIDENCE), { recursive: true });
  fs.writeFileSync(FRAME_EVIDENCE, `${JSON.stringify({ fixture: 'band-row.mp4', tolerance: 'mean absolute RGB difference at 64x36 against the generated 640x360 JPEG; the coach crop view and the saved-time frame must be < 12 and at least 2x below the scrub-position control', poster: { saved_ms: 500, scrub_ms: 4000, crop_px: posterCrop.rect, ...poster }, end_still: { saved_ms: 5000, scrub_ms: 1000, crop_px: endCrop.rect, ...end } }, null, 2)}\n`);
  for (const result of [poster, end]) {
    expect(result.output).toMatchObject({ width: 640, height: 360 });
    expect(result.selected).toBeLessThan(12);
    expect(result.coachView).toBeLessThan(12);
    expect(result.selected * 2).toBeLessThan(result.scrubControl);
    expect(result.coachView * 2).toBeLessThan(result.scrubControl);
  }
  await approveAndPublish(page, editor);
});

// R2 follow-up through the real upload → FFmpeg worker path: changing the
// saved poster time while its crop is open reloads the NEW frame before any
// crop edit; the published poster shows the new phase (the old phase is the
// negative control).
const CHANGE_EVIDENCE = path.join(ROOT, '.exercise-media-local/evidence/r2-followup/real-selection-change.json');

test('coach: changing the saved poster time with the crop open reloads that frame; the published poster shows the new phase', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, 'coach-a');
  const editor = await openMedia(page, 'Synthetic Shuttle Walk');
  await editor.getByTestId('media-confirm-identity').click();
  await editor.getByTestId('media-new-draft').click();
  await editor.getByTestId('media-file-source_video').setInputFiles(fixture('band-row.mp4'));
  await editor.getByTestId('media-rights-confirm-source_video').click();
  await editor.getByTestId('media-upload-start-source_video').click();
  await expect(editor.getByTestId('media-source-facts')).toContainText('Video 1280×720');
  const video = editor.getByTestId('video-selection-video');
  await expect.poll(() => video.evaluate((el) => el.readyState)).toBeGreaterThanOrEqual(1);
  const posterField = editor.getByLabel('Poster', { exact: true });
  await posterField.fill('0.5'); await posterField.press('Enter');
  await editor.getByRole('button', { name: 'Crop poster', exact: true }).click();
  const img = editor.getByTestId('crop-poster').locator('img');
  await expect(img).toHaveAttribute('src', /^data:image\/jpeg/);
  await expect(editor.getByTestId('video-frame-target')).toContainText('0:00.5');
  const oldView = await img.getAttribute('src');
  // Change the saved time while the crop is open.
  await posterField.fill('3.5'); await posterField.press('Enter');
  await expect(editor.getByTestId('video-frame-target')).toContainText('0:03.5');
  await expect.poll(async () => (await img.getAttribute('src').catch(() => null)) || '').toMatch(/^data:image\/jpeg/);
  await expect.poll(async () => (await img.getAttribute('src')) !== oldView).toBe(true);
  const area = editor.getByTestId('crop-poster-area');
  await area.focus();
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('+');
  await page.keyboard.press('Shift+ArrowRight');
  const readout = await editor.getByTestId('crop-poster-readout').textContent();
  const [, width, height, x, y] = readout.match(/(\d+)×(\d+) px from \((\d+), (\d+)\)/).map(Number);
  const viewSrc = await img.getAttribute('src');
  await editor.getByTestId('video-frame-crop').getByRole('button', { name: 'Done' }).click();
  await editor.getByTestId('media-alt-text').fill('Synthetic shuttle walk start still');
  await editor.getByTestId('media-save').click();
  await expect(editor.getByTestId('media-process')).toBeEnabled();
  await editor.getByTestId('media-process').click();
  await expect(editor.getByTestId('media-draft-editor')).toHaveAttribute('data-status', 'ready', { timeout: 180_000 });
  const review = editor.getByTestId('media-derivative-review');
  await expect.poll(() => review.getByTestId('review-poster').evaluate((el) => el.complete && el.naturalWidth)).toBe(640);
  const url = await review.getByTestId('review-poster').getAttribute('src');
  await expect.poll(() => video.evaluate((el) => el.readyState)).toBeGreaterThanOrEqual(1);
  const result = await compareOutput(page, { targetMs: 3500, controlMs: 500, rect: { x, y, width, height }, viewSrc, url });
  fs.mkdirSync(path.dirname(CHANGE_EVIDENCE), { recursive: true });
  fs.writeFileSync(CHANGE_EVIDENCE, `${JSON.stringify({ fixture: 'band-row.mp4', sequence: 'Crop poster at saved 0.5 s, then (crop still open) saved time changed to 3.5 s, keyboard crop, save, process', tolerance: 'mean absolute RGB difference at 64x36 against the generated 640x360 JPEG; coach view and new saved-time frame < 12 and at least 2x below the old-phase control', poster: { old_saved_ms: 500, new_saved_ms: 3500, crop_px: { x, y, width, height }, ...result, scrubControl_is_old_phase_500ms: result.scrubControl } }, null, 2)}\n`);
  expect(result.output).toMatchObject({ width: 640, height: 360 });
  expect(result.selected).toBeLessThan(12);
  expect(result.coachView).toBeLessThan(12);
  expect(result.selected * 2).toBeLessThan(result.scrubControl);
  expect(result.coachView * 2).toBeLessThan(result.scrubControl);
  await approveAndPublish(page, editor);
});
