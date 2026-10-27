// Paired visual evidence for exercise media: the SAME mocked API data and the
// SAME real processed synthetic assets are served to the baseline checkout
// (8d68a78, project "baseline") and to this tree (project "proposed").
// Baseline ignores the media fields it does not know; nothing is invented for
// it. Run: npm --prefix frontend run capture:media-visual (see config).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ASSETS = path.join(ROOT, '.exercise-media-local/visual-assets');
const FIXTURES = path.join(ROOT, '.exercise-media-local/fixtures');
const OUT = path.join(ROOT, 'docs/exercise-media/visual-review/images');
const METRICS = path.join(ROOT, '.exercise-media-local/evidence/visual-metrics');
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const asset = (name) => fs.readFileSync(path.join(ASSETS, name));
const CONTENT = {
  'poster-goblet': ['image/jpeg', 'goblet-poster.jpg'], 'poster-split': ['image/jpeg', 'split-poster.jpg'], 'poster-row': ['image/jpeg', 'row-poster.jpg'],
  'preview-row': ['video/mp4', 'row-preview.mp4'], 'instruction-row': ['video/mp4', 'row-instruction.mp4'], 'captions-row': ['text/vtt', 'row-captions.vtt'],
  'poster-plank': ['image/jpeg', 'plank-poster.jpg'], 'end-plank': ['image/jpeg', 'plank-end.jpg'],
  'source-split': ['image/jpeg', null, 'split-squat-portrait.jpg'], 'source-row-video': ['video/mp4', null, 'band-row.mp4'],
};
const base = (exercise, extra) => ({ exercise_id: exercise, version: 1, cues: ['Synthetic cue — not instruction'], end_frame: null, preview: null, instruction: null, transcript_available: false, ...extra });
const MEDIA = {
  goblet: base('lib-goblet', { revision_id: 'rev-goblet', kind: 'photo', alt_text: 'Synthetic test photo for the goblet squat identity', poster: { asset_id: 'poster-goblet', width: 640, height: 360 } }),
  split: base('lib-split', { revision_id: 'rev-split', kind: 'photo', alt_text: 'Synthetic test photo for the split squat identity (portrait source)', poster: { asset_id: 'poster-split', width: 640, height: 360 } }),
  row: base('lib-row', { revision_id: 'rev-row', kind: 'video', alt_text: 'Synthetic test thumbnail for the band row identity', poster: { asset_id: 'poster-row', width: 640, height: 360 },
    preview: { asset_id: 'preview-row', duration_ms: 2000, width: 640, height: 360, bytes: 13367 },
    instruction: { asset_id: 'instruction-row', duration_ms: 6000, width: 1280, height: 720, bytes: 44708, has_audio: false, captions_available: true, captions_asset_id: 'captions-row', caption_language: 'en' }, transcript_available: true }),
  plank: base('lib-plank', { revision_id: 'rev-plank', kind: 'frames', alt_text: 'Synthetic start still', poster: { asset_id: 'poster-plank', width: 640, height: 360 }, end_frame: { asset_id: 'end-plank', width: 640, height: 360, alt_text: 'Synthetic end still' } }),
};
const EXERCISES = [
  ['goblet', 'Synthetic Goblet Squat', MEDIA.goblet, null], ['split', 'Synthetic Split Squat', MEDIA.split, null],
  ['row', 'Synthetic Band Row', MEDIA.row, 'https://example.com/synthetic-coach-override'], ['plank', 'Synthetic Plank', MEDIA.plank, null],
  ['shuttle', 'Synthetic Shuttle Walk', null, null], ['wall', 'Synthetic Wall Sit (no media)', null, null], ['custom', 'Synthetic custom move (no library id)', null, null],
];
function log(id, status) {
  return {
    id, client_id: 'client-1', workout_name: 'Synthetic media session', status, started_at: '2026-10-15T15:00:00.000Z', completed_at: status === 'completed' ? '2026-10-15T16:00:00.000Z' : null, coach_responses: [], attribution: 'client',
    exercises: EXERCISES.map(([key, name, media, video], index) => ({
      id: `${id}-ex-${key}`, exercise_name: name, exercise_library_id: key === 'custom' ? null : `lib-${key}`, tracking_type: 'reps_weight', prescribed_sets: 2, prescribed_reps: '8', prescribed_rpe: '7', prescribed_rest_seconds: 60, sort_order: index, position: index, video_url: video,
      ...(key === 'custom' ? {} : { media }),
      sets: [1, 2].map((n) => ({ id: `${id}-${key}-set-${n}`, workout_log_exercise_id: `${id}-ex-${key}`, set_number: n, status: status === 'completed' ? 'completed' : 'pending', set_origin: 'prescribed', actual_load_value: status === 'completed' ? 20 : null, actual_load_unit: 'lb', actual_reps: status === 'completed' ? 8 : null, actual_rpe: status === 'completed' ? 7 : null, entered_by: 'client' })),
    })),
  };
}
const LIBRARY = [...EXERCISES.filter(([key]) => key !== 'custom').map(([key, name]) => ({ id: `lib-${key}`, name, category: 'Synthetic', equipment: key === 'goblet' ? 'Kettlebell' : 'Synthetic', primary_muscle: 'Synthetic', video_url: key === 'row' ? 'https://example.com/synthetic-library-band-row' : null, hidden: false, archived: false })),
  ...['Synthetic Filler A', 'Synthetic Filler B'].map((name, i) => ({ id: `lib-filler-${i}`, name, category: 'Synthetic', equipment: 'None', primary_muscle: 'Synthetic', video_url: null, hidden: false, archived: false }))];
const STATUS = { items: LIBRARY.map((e) => ({ exercise_id: e.id, current_version: ['lib-goblet', 'lib-split', 'lib-row', 'lib-plank'].includes(e.id) ? 1 : 0, current_revision_id: null, current_kind: { 'lib-goblet': 'photo', 'lib-split': 'photo', 'lib-row': 'video', 'lib-plank': 'frames' }[e.id] || 'none', current_has_instruction: e.id === 'lib-row', current_owned_by_you: true, drafts_open: e.id === 'lib-goblet' ? 1 : 0, drafts_needs_review: e.id === 'lib-goblet' ? 1 : 0, drafts_ready_to_publish: 0, drafts_processing: 0, drafts_failed: e.id === 'lib-shuttle' ? 1 : 0 })),
  summary: { total: 8, no_media: 4, photo_only: 2, frames: 1, ready_video: 1, needs_review: 1, processing: 0, processing_failed: 1 } };
const permissions = (extra = {}) => ({ can_edit: true, can_upload: true, can_process: true, can_review: false, can_publish: false, publish_requires_admin: false, can_archive: true, ...extra });
const revision = (id, exercise, extra) => ({ id, exercise_id: exercise, status: 'draft', review_status: 'needs_review', version: 3, recipe_version: 2, failure_code: null, based_on_revision_id: null, owned_by_you: true, owner_name: 'Synthetic Coach Avery', published_at: null, is_current: false, archived: false, created_at: '2026-10-15T15:00:00.000Z', updated_at: '2026-10-15T15:00:00.000Z',
  text: { alt_text: '', end_frame_alt_text: null, cues: [], transcript: null, caption_language: null, caption_cues: [], instruction_audio: false },
  recipe: { include_instruction: false, poster_mode: null, poster_frame_ms: null, poster_crop: null, preview_start_ms: null, preview_end_ms: null, preview_crop: null, end_frame_ms: null, end_frame_crop: null },
  reviewed: null, sources: { image: null, video: null }, derivatives: [], job: null, permissions: permissions(), ...extra });
const REVISIONS = {
  'lib-goblet': { current: revision('rev-goblet', 'lib-goblet', { status: 'ready', review_status: 'approved', is_current: true, published_at: '2026-10-14T15:00:00.000Z', text: { ...revision().text, alt_text: MEDIA.goblet.alt_text, cues: MEDIA.goblet.cues }, derivatives: [{ asset_id: 'poster-goblet', role: 'poster', width: 640, height: 360, bytes: 20028 }], permissions: permissions({ can_edit: false, can_process: false }) }),
    drafts: [revision('rev-goblet-video', 'lib-goblet', { status: 'ready', text: { ...revision().text, alt_text: MEDIA.goblet.alt_text, cues: MEDIA.goblet.cues }, recipe: { ...revision().recipe, poster_mode: 'uploaded_image', poster_crop: { x: 0, y: 0, width: 1, height: 1 }, preview_start_ms: 1000, preview_end_ms: 3000 },
      derivatives: [{ asset_id: 'poster-goblet', role: 'poster', width: 640, height: 360, bytes: 20028 }, { asset_id: 'preview-row', role: 'preview', width: 640, height: 360, duration_ms: 2000, bytes: 13367, has_audio: false }], permissions: permissions({ can_edit: true, can_review: true }) })] },
  'lib-split': { current: null, drafts: [revision('rev-split-draft', 'lib-split', { text: { ...revision().text, alt_text: 'Synthetic test photo for the split squat identity (portrait source)' }, recipe: { ...revision().recipe, poster_mode: 'uploaded_image', poster_crop: { x: 0, y: 0.1, width: 1, height: (1080 * 9 / 16) / 1350 } }, sources: { image: { asset_id: 'source-split', mime_type: 'image/jpeg', bytes: 65868, width: 1080, height: 1350, duration_ms: null, has_audio: null, display_name: 'split-squat-portrait.jpg', rights_basis: 'owned', rights_note: null, uploaded_by_you: true, copied: false }, video: null } })] },
  'lib-row': { current: null, drafts: [revision('rev-row-draft', 'lib-row', { text: { ...revision().text, alt_text: 'Synthetic test thumbnail for the band row identity' }, recipe: { ...revision().recipe, poster_mode: 'video_frame', poster_frame_ms: 1200, poster_crop: { x: 0, y: 0, width: 1, height: 1 }, preview_start_ms: 1000, preview_end_ms: 3000, preview_crop: { x: 0, y: 0, width: 1, height: 1 } }, sources: { image: null, video: { asset_id: 'source-row-video', mime_type: 'video/mp4', bytes: 45376, width: 1280, height: 720, duration_ms: 6000, has_audio: false, display_name: 'band-row.mp4', rights_basis: 'owned', rights_note: null, uploaded_by_you: true, copied: false } } })] },
};

async function mock(page, role, { failPoster = false } = {}) {
  if (!page.cvfErrorsHooked) { page.cvfErrorsHooked = true; page.on('pageerror', (error) => console.log(`PAGEERROR ${error.message}`)); }
  await page.addInitScript(() => localStorage.setItem('cvf_access_token', 'synthetic-visual-token'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const p = url.pathname.replace(/^\/api/, '');
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (p === '/auth/me') return json(role === 'coach' ? { role: 'coach', email: 'coach-a@example.invalid', profile: { id: 'coach-a', name: 'Synthetic Coach Avery', is_admin: false } } : { role: 'client', email: 'client-1@example.invalid', profile: { id: 'client-1', name: 'Synthetic Client Riley', waiver_signed: true } });
    if (p === '/telemetry/events') return route.fulfill({ status: 204 });
    if (p.endsWith('/unread-count')) return json({ unread: 0 });
    if (p === '/workout-logs/vis-log') return json(log('vis-log', 'active'));
    if (p === '/workout-logs/vis-done') return json(log('vis-done', 'completed'));
    if (/\/history$/.test(p)) return json({ occurrences: [], next_cursor: null });
    if (p === '/programs/exercise-library') return json(LIBRARY);
    if (p === '/programs/workouts' || p === '/programs' || p === '/clients') return json([]);
    if (p === '/exercise-media/library-status') return json(STATUS);
    const revisions = p.match(/^\/exercise-media\/exercises\/([^/]+)\/revisions$/);
    if (revisions) {
      const entry = REVISIONS[revisions[1]] || { current: null, drafts: [] };
      const exercise = LIBRARY.find((e) => e.id === revisions[1]);
      return json({ exercise: { id: exercise.id, name: exercise.name, equipment: exercise.equipment, category: exercise.category, primary_muscle: exercise.primary_muscle, hidden: false }, current: entry.current, current_version: entry.current ? 1 : 0, drafts: entry.drafts, next_before: null });
    }
    if (p === '/exercise-media/links') {
      const body = request.postDataJSON();
      return json({ links: body.assets.map(({ asset_id: id }) => ({ asset_id: id, url: `/api/exercise-media/content/${id}.visual`, expires_at: new Date(Date.now() + 60_000).toISOString() })), missing: [] });
    }
    if (p === '/exercise-media/text') return json({ transcript: 'Synthetic transcript for a synthetic clip. Not exercise instruction.', caption_language: 'en' });
    const content = p.match(/^\/exercise-media\/content\/([^.]+)\.visual$/);
    if (content) {
      if (failPoster && content[1] === 'poster-goblet') return route.fulfill({ status: 403, contentType: 'application/json', body: '{"code":"link_expired"}' });
      const [type, file, fixture] = CONTENT[content[1]];
      const body = file ? asset(file) : fs.readFileSync(path.join(FIXTURES, fixture));
      // Single-range support, like the real content route, so media elements load.
      const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers().range || '');
      if (range && range[1] !== '') {
        const start = Number(range[1]);
        const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
        return route.fulfill({ status: 206, contentType: type, body: body.subarray(start, end + 1), headers: { 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${body.length}` } });
      }
      return route.fulfill({ status: 200, contentType: type, body, headers: { 'accept-ranges': 'bytes' } });
    }
    return json({ error: `visual capture: unmocked ${request.method()} ${p}` }, 404);
  });
}


// Frames a card with its top just below the fixed app header, whether the
// tracker scrolls its own region or (short/narrow windows) the document.
async function frameCard(locator) {
  await locator.evaluate((el) => {
    el.scrollIntoView({ block: 'start', behavior: 'instant' });
    const header = document.querySelector('header');
    const offset = (header ? header.getBoundingClientRect().bottom : 64) + 12;
    const top = el.getBoundingClientRect().top;
    if (top < offset) {
      const region = el.closest('[data-testid="workout-scroll-region"]');
      if (region && region.scrollHeight > region.clientHeight) region.scrollBy({ top: top - offset, behavior: 'instant' });
      window.scrollBy({ top: el.getBoundingClientRect().top - offset, behavior: 'instant' });
    }
  });
}

const VIEWPORTS = [[320, 740], [390, 844], [1440, 900]];
const manifest = [];
function source(variant) {
  const dir = variant === 'baseline' ? process.env.CVF_VISUAL_BASELINE_DIR : ROOT;
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
  return { commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), tracked_changes: git('status', '--porcelain', '--untracked-files=no', '--', '.', ':(exclude)docs/exercise-media/visual-review').split('\n').filter(Boolean) };
}
async function shot(page, state, width, height, note) {
  const variant = test.info().project.name;
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const name = `${state}-${variant}-${width}x${height}.png`;
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false, animations: 'disabled' });
  const metrics = await page.evaluate(() => {
    const box = (selector) => { const el = document.querySelector(selector); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; };
    return { scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, slot: box('[data-testid="exercise-media-slot"]'), firstSetInput: box('[data-testid="tracker-exercise-card"] input'), dock: box('[data-testid="workout-control-dock"]'), firstCard: box('[data-testid="tracker-exercise-card"]') };
  });
  const bytes = fs.readFileSync(file);
  manifest.push({ file: `images/${name}`, state, variant, viewport: { width, height }, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, note, metrics, source: source(variant) });
}

test.afterAll(() => {
  fs.mkdirSync(METRICS, { recursive: true });
  fs.writeFileSync(path.join(METRICS, `${test.info().project.name}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
});

for (const [width, height] of VIEWPORTS) {
  test(`tracker states at ${width}x${height}`, async ({ page }) => {
    const proposed = test.info().project.name === 'proposed';
    await page.setViewportSize({ width, height });
    await mock(page, 'client');
    await page.goto('/client/workouts/vis-log/track');
    await expect(page.getByTestId('tracker-exercise-card').first()).toBeVisible({ timeout: 45_000 });
    if (proposed) await expect.poll(() => page.getByTestId('exercise-media-poster').first().evaluate((img) => img.complete && img.naturalWidth)).toBe(640);
    await shot(page, 'tracker-top', width, height, 'Active exercise header: proposed compact 96px poster + cues (default); baseline text card.');
    if (proposed) {
      await page.getByTestId('exercise-media-expand').first().click();
      await shot(page, 'tracker-larger', width, height, 'Bold probe footprint: the same card with the bounded full-width slot (Larger).');
      await page.getByTestId('exercise-media-expand').first().click();
    }
    const row = page.getByTestId('tracker-exercise-card').nth(2);
    await row.scrollIntoViewIfNeeded();
    if (proposed) {
      await row.getByRole('button', { name: /Show movement preview/ }).click();
      await expect.poll(() => row.getByTestId('exercise-media-poster').evaluate((img) => img.complete && img.naturalWidth)).toBe(640);
    }
    await frameCard(row);
    await shot(page, 'tracker-video-card', width, height, 'Video exercise card (deferred until requested); External video link kept.');
    if (proposed) {
      await row.getByTestId('exercise-media-instruction').click();
      await expect(page.getByTestId('exercise-instruction-video')).toBeVisible();
      await expect.poll(() => page.getByTestId('exercise-instruction-video').evaluate((el) => el.readyState)).toBeGreaterThanOrEqual(2);
      await page.getByTestId('exercise-instruction-video').evaluate((el) => new Promise((resolve) => { el.addEventListener('seeked', resolve, { once: true }); el.currentTime = 1; }));
      // Wait until the seeked frame is decodable so the native buffering spinner is not captured.
      await expect.poll(() => page.getByTestId('exercise-instruction-video').evaluate((el) => el.readyState)).toBeGreaterThanOrEqual(3);
      await expect.poll(() => page.getByTestId('exercise-instruction-video').evaluate((el) => ({ network: el.networkState, ready: el.readyState, seeking: el.seeking })), { timeout: 15_000 }).toEqual({ network: 1, ready: 4, seeking: false });
      await page.mouse.move(2, 2);
      await page.getByTestId('exercise-instruction-transcript').click();
      await expect(page.getByTestId('exercise-instruction-transcript-text')).toBeVisible();
      await shot(page, 'tracker-instruction-dialog', width, height, 'Full instruction dialog (new surface; baseline has no equivalent).');
      await page.keyboard.press('Escape');
    }
  });

  test(`failure, history and library states at ${width}x${height}`, async ({ page }) => {
    const proposed = test.info().project.name === 'proposed';
    await page.setViewportSize({ width, height });
    await mock(page, 'client', { failPoster: true });
    await page.goto('/client/workouts/vis-log/track');
    await expect(page.getByTestId('tracker-exercise-card').first()).toBeVisible({ timeout: 45_000 });
    if (proposed) await expect(page.getByText('Preview unavailable')).toBeVisible();
    await shot(page, 'tracker-poster-failed', width, height, 'Expired/404 poster: calm text fallback + Retry; logging unaffected.');
    await page.goto('/client/workouts/vis-done');
    await expect(page.getByText('Synthetic Goblet Squat').first()).toBeVisible();
    await shot(page, 'history-detail', width, height, 'Completed workout: "Current exercise guide" action (proposed) — today\'s guide, not a historical record.');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await mock(page, 'coach');
    await page.goto('/coach/programs');
    await expect(page.getByTestId('exercise-library-card').first()).toBeVisible();
    await shot(page, 'coach-library', width, height, 'Exercise library: media readiness filter, summary and badges (proposed).');
    await page.getByTestId('exercise-library-card').filter({ hasText: 'Synthetic Band Row' }).getByTestId('exercise-library-edit-button').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await shot(page, 'coach-edit-exercise', width, height, 'Exercise edit dialog: external link relabelled "External video link (optional)".');
    if (proposed) {
      await page.keyboard.press('Escape');
      await page.getByTestId('exercise-library-card').filter({ hasText: 'Synthetic Goblet Squat' }).getByTestId('exercise-library-media-button').click();
      await expect(page.getByTestId('media-review')).toBeVisible();
      await expect.poll(() => page.getByTestId('review-poster').evaluate((img) => img.complete && img.naturalWidth)).toBe(640);
      await shot(page, 'coach-media-review', width, height, 'Media editor: current guide + a ready draft awaiting explicit review (new surface).');
      await page.getByTestId('media-review').scrollIntoViewIfNeeded();
      await shot(page, 'coach-media-review-attest', width, height, 'Review attestation: exact variant, rights and content must each be confirmed.');
      await page.keyboard.press('Escape');
      await page.getByTestId('exercise-library-card').filter({ hasText: 'Synthetic Split Squat' }).getByTestId('exercise-library-media-button').click();
      await expect(page.getByTestId('poster-crop-area')).toBeVisible();
      await page.getByTestId('poster-crop-area').scrollIntoViewIfNeeded();
      await shot(page, 'coach-media-crop', width, height, 'Image-only draft: keyboard 16:9 crop over the EXIF-rotated portrait source with live preview.');
      await page.keyboard.press('Escape');
      await page.getByTestId('exercise-library-card').filter({ hasText: 'Synthetic Band Row' }).getByTestId('exercise-library-media-button').click();
      await expect(page.getByTestId('video-selection-editor')).toBeVisible();
      await page.getByTestId('video-selection-scrub').scrollIntoViewIfNeeded();
      await shot(page, 'coach-media-video', width, height, 'Video draft: scrub, poster frame, 1–8 s preview in/out and end still with exact-time inputs.');
    }
  });
}

test('proposed refinement checks: 200% zoom, short keyboard viewport, data saver', async ({ page }) => {
  test.skip(test.info().project.name !== 'proposed', 'proposed-only refinement evidence');
  await page.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { saveData: true }, configurable: true }));
  await page.setViewportSize({ width: 640, height: 450 });
  await mock(page, 'client');
  await page.goto('/client/workouts/vis-log/track');
  await expect(page.getByTestId('exercise-media-poster').first()).toBeVisible();
  await shot(page, 'refine-zoom200', 640, 450, '1280x900 at 200% zoom (640x450 CSS px): no overflow, poster bounded.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 420 });
  const weight = page.getByTestId('tracker-exercise-card').first().getByRole('spinbutton', { name: /set 1 weight/ });
  await weight.focus();
  await page.waitForTimeout(300);
  await shot(page, 'refine-keyboard-short', 390, 420, 'Short (keyboard-open) viewport: focused weight input stays visible above the controls.');
  const input = await weight.boundingBox();
  const dock = await page.getByTestId('workout-control-dock').boundingBox();
  expect(input.y + input.height <= dock.y || input.y >= dock.y + dock.height).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  const row = page.getByTestId('tracker-exercise-card').nth(2);
  await row.getByRole('button', { name: /Show movement preview/ }).click();
  await frameCard(row);
  await expect(row.getByTestId('exercise-media-play')).toContainText('MB');
  await shot(page, 'refine-data-saver', 390, 844, 'Data saver + reduced motion: still only; Play preview shows its size; nothing autoplays.');
});
