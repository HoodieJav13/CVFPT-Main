// Paired visual evidence for Photo + YouTube guides (docs/exercise-guides/).
// The SAME mocked API data and the SAME real processed synthetic posters are
// served to the pinned baseline checkout (f3c063c, project "baseline") and to
// this tree (project "proposed"). The baseline ignores fields it does not know
// (`demo`, `video_link_mode`); nothing is invented for it. Every YouTube host is
// routed to a deterministic stub: the dialog player shown here is a labelled
// synthetic page, never Google's player. Reduced motion throughout.
// Run: CVF_GUIDES_BASELINE_DIR=<pinned clone> npx playwright test --config playwright.exercise-guides-visual.config.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';

const ROOT = path.resolve(import.meta.dirname, '../..');
const ASSETS = path.join(ROOT, '.exercise-media-local/guides-visual-assets');
const OUT = path.join(ROOT, 'docs/exercise-guides/visual-review/images');
const METRICS = path.join(ROOT, '.exercise-media-local/evidence/guides-visual-metrics');
const CLIP = path.join(import.meta.dirname, 'fixtures/exercise-media/synthetic-moving-geometry.mp4');
test.describe.configure({ mode: 'serial' });

const ID_A = 'SYNTHdemo01';
const ID_B = 'SYNTHdemo02';
const YT_A = `https://youtu.be/${ID_A}`;
const YT_B = `https://youtu.be/${ID_B}`;
const OVERRIDE = 'https://example.com/synthetic-coach-override';
const LONG = 'Synthetic Wall Sit with an intentionally long identity label for wrapping checks';
const PROVIDER = /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|ytimg\.com|googlevideo\.com|doubleclick\.net|google\.com|gstatic\.com)$/;
const POSTERS = { 'poster-goblet': 'goblet-poster.jpg', 'poster-split': 'split-poster.jpg', 'poster-row': 'row-poster.jpg' };
const yt = (id, source) => ({ kind: 'youtube', url: `https://www.youtube.com/watch?v=${id}`, video_id: id, source, current_guide: true });
const ext = (url, source) => ({ kind: 'external', url, source, current_guide: true });
const photo = (key, alt) => ({ exercise_id: `lib-${key}`, revision_id: `rev-${key}`, version: 1, kind: 'photo', alt_text: alt, cues: ['Synthetic cue: chest tall', 'Synthetic cue: slow lower'], poster: { asset_id: `poster-${key}`, width: 640, height: 360 }, end_frame: null, preview: null, instruction: null, transcript_available: false });

// [key, name, media, resolved video_url (what both backends return), demo DTO (new backend only)]
const EXERCISES = [
  ['goblet', 'Synthetic Goblet Squat', photo('goblet', 'Synthetic test photo for the goblet squat identity'), YT_A, yt(ID_A, 'library')],
  ['split', 'Synthetic Split Squat', photo('split', 'Synthetic test photo for the split squat identity'), null, null],
  ['row', 'Synthetic Band Row', photo('row', 'Synthetic test photo for the band row identity'), OVERRIDE, ext(OVERRIDE, 'override')],
  ['wall', LONG, null, YT_B, yt(ID_B, 'legacy')],
  ['custom', 'Synthetic custom move (no library id)', null, null, null],
];
function log(id, status) {
  return {
    id, client_id: 'client-1', workout_name: 'Synthetic guides session', status, started_at: '2026-10-15T15:00:00.000Z', completed_at: status === 'completed' ? '2026-10-15T16:00:00.000Z' : null, coach_responses: [], attribution: 'client',
    exercises: EXERCISES.map(([key, name, media, video, demo], index) => ({
      id: `${id}-ex-${key}`, exercise_name: name, exercise_library_id: key === 'custom' ? null : `lib-${key}`, tracking_type: 'reps_weight', prescribed_sets: 2, prescribed_reps: '8', prescribed_rpe: '7', prescribed_rest_seconds: 60, sort_order: index, position: index,
      video_url: video, ...(demo ? { demo } : { demo: null }), ...(key === 'custom' ? {} : { media }),
      sets: [1, 2].map((n) => ({ id: `${id}-${key}-set-${n}`, workout_log_exercise_id: `${id}-ex-${key}`, set_number: n, status: status === 'completed' ? 'completed' : 'pending', set_origin: 'prescribed', actual_load_value: status === 'completed' ? 20 : null, actual_load_unit: 'lb', actual_reps: status === 'completed' ? 8 : null, actual_rpe: status === 'completed' ? 7 : null, entered_by: 'client' })),
    })),
  };
}
const LIBRARY = [
  { id: 'lib-goblet', name: 'Synthetic Goblet Squat', category: 'Synthetic', equipment: 'Kettlebell', primary_muscle: 'Synthetic', video_url: YT_A, hidden: false, archived: false },
  { id: 'lib-split', name: 'Synthetic Split Squat', category: 'Synthetic', equipment: 'None', primary_muscle: 'Synthetic', video_url: null, hidden: false, archived: false },
  { id: 'lib-row', name: 'Synthetic Band Row', category: 'Synthetic', equipment: 'Band', primary_muscle: 'Synthetic', video_url: 'https://example.com/synthetic-library-band-row', hidden: false, archived: false },
  { id: 'lib-wall', name: LONG, category: 'Synthetic', equipment: 'None', primary_muscle: 'Synthetic', video_url: null, hidden: false, archived: false },
];
const STATUS = {
  items: LIBRARY.map((e) => ({ exercise_id: e.id, current_version: e.id === 'lib-wall' ? 0 : 1, current_revision_id: null, current_kind: e.id === 'lib-wall' ? 'none' : 'photo', current_has_instruction: false, current_owned_by_you: true, drafts_open: e.id === 'lib-wall' ? 1 : 0, drafts_needs_review: 0, drafts_ready_to_publish: 0, drafts_processing: 0, drafts_failed: 0 })),
  summary: { total: 4, no_media: 1, photo_only: 3, frames: 0, ready_video: 0, needs_review: 0, processing: 0, processing_failed: 0 },
};
const row = (id, libraryId, extra) => ({
  id, exercise_library_id: libraryId, custom_name: null, library_exercise: libraryId ? LIBRARY.find((e) => e.id === libraryId) : null,
  sets: 3, reps: '8', rest: '60s', tempo: '', target_rpe: '7', default_load_value: null, default_load_unit: 'lb', client_notes: '', coach_notes: '', tracking_type: 'reps_weight', superset_group: null, ...extra,
});
// Template rows: library-inheriting (new), explicit custom link (new), an
// unclassified legacy link (pre-existing data), and a custom exercise.
const TEMPLATE_ROWS = [
  row('we-goblet', 'lib-goblet', { video_link_mode: 'inherit', video_url: null, sort_order: 0 }),
  row('we-row', 'lib-row', { video_link_mode: 'override', video_url: OVERRIDE, sort_order: 1 }),
  row('we-wall', 'lib-wall', { video_link_mode: null, video_url: YT_B, sort_order: 2 }),
  row('we-custom', null, { custom_name: 'Synthetic custom move (no library id)', video_link_mode: null, video_url: null, sort_order: 3 }),
];
const WORKOUT = { id: 'wk-guides', name: 'Synthetic guides session', description: null, goal: 'Synthetic capture fixture', hidden: false, archived: false, author: { name: 'Synthetic Coach Avery' }, exercise_count: TEMPLATE_ROWS.length, exercises: TEMPLATE_ROWS };
// Client-facing assignment rows: resolved video_url + demo, like the real API.
const CLIENT_ROWS = TEMPLATE_ROWS.map((r, i) => ({ ...r, video_link_mode: undefined, video_url: EXERCISES[[0, 2, 3, 4][i]][3], demo: EXERCISES[[0, 2, 3, 4][i]][4] }));
const ASSIGNED = { programs: [], workouts: [{ id: 'wa-guides', assignment_mode: 'active', assigned_for: null, notes: null, exercise_loads: [], workout: { ...WORKOUT, exercises: CLIENT_ROWS } }] };
const CLIENT = { id: 'client-1', coach_id: 'coach-a', name: 'Synthetic Client Riley', email: 'client-1@example.invalid', archived: false };
const permissions = { can_edit: true, can_upload: true, can_process: false, can_review: false, can_publish: false, publish_requires_admin: false, can_archive: true };
const DRAFT = {
  id: 'rev-wall-draft', exercise_id: 'lib-wall', status: 'draft', review_status: 'needs_review', version: 1, recipe_version: 2, failure_code: null, based_on_revision_id: null, owned_by_you: true, owner_name: 'Synthetic Coach Avery', published_at: null, is_current: false, archived: false, created_at: '2026-10-15T15:00:00.000Z', updated_at: '2026-10-15T15:00:00.000Z',
  text: { alt_text: '', end_frame_alt_text: null, cues: [], transcript: null, caption_language: null, caption_cues: [], instruction_audio: false },
  recipe: { include_instruction: false, poster_mode: null, poster_frame_ms: null, poster_crop: null, preview_start_ms: null, preview_end_ms: null, preview_crop: null, end_frame_ms: null, end_frame_crop: null },
  reviewed: null, sources: { image: null, video: null }, derivatives: [], job: null, permissions,
};
const CAPS = { enabled: true, mode: 'photos', video_sources: false, upload_transport: 'grant', processing: 'inline', local_still_selection: true, processing_available: true, limits: {} };

// The provider stub. The "player" is a plainly labelled synthetic page.
const STUB = '<!doctype html><title>synthetic embed stub</title><body style="margin:0;display:grid;place-items:center;height:100vh;background:#222;color:#ddd;font:14px system-ui">Synthetic embed stub: not YouTube</body>';
const SHIM = `window.YT = { Player: function (el, opts) { this.destroy = () => {}; this.pauseVideo = () => {};
  const mode = window.__ytMode || 'ready';
  setTimeout(() => { if (mode === 'ready') opts.events && opts.events.onReady && opts.events.onReady({ target: this });
    else if (mode !== 'silent') opts.events && opts.events.onError && opts.events.onError({ target: this, data: Number(mode) }); }, 30); } };
  if (typeof window.onYouTubeIframeAPIReady === 'function') window.onYouTubeIframeAPIReady();`;

const unmocked = [];
async function mock(page, role, { failPoster = false, ytMode = 'ready', apiBlocked = false } = {}) {
  if (!page.cvfHooked) {
    page.cvfHooked = true;
    page.cvfProvider = [];
    page.on('pageerror', (error) => console.log(`PAGEERROR ${error.message}`));
    page.on('request', (request) => { if (PROVIDER.test(new URL(request.url()).hostname)) page.cvfProvider.push(request.url()); });
  }
  await page.addInitScript((mode) => { localStorage.setItem('cvf_access_token', 'synthetic-visual-token'); window.__ytMode = mode; }, ytMode);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route((url) => PROVIDER.test(url.hostname), (route) => {
    const url = new URL(route.request().url());
    if (url.href === 'https://www.youtube.com/iframe_api') return apiBlocked ? route.abort('blockedbyclient') : route.fulfill({ status: 200, contentType: 'text/javascript', body: SHIM });
    if (url.hostname === 'www.youtube-nocookie.com' && url.pathname.startsWith('/embed/')) return route.fulfill({ status: 200, contentType: 'text/html', body: STUB });
    return route.abort('blockedbyclient');
  });
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
    if (p === '/workout-logs/active') return json(null);
    if (p === '/workout-logs/mine') return json({ logs: [], next_cursor: null });
    if (/\/history$/.test(p)) return json({ occurrences: [], next_cursor: null });
    if (p === '/programs/client/assigned') return json(ASSIGNED);
    if (p === '/programs/exercise-library') return json(LIBRARY);
    if (p === '/programs/workouts') return json(role === 'coach' ? [WORKOUT] : []);
    if (p === '/programs' || p === '/clients') return json(p === '/clients' ? [CLIENT] : []);
    if (p === '/clients/client-1') return json(CLIENT);
    if (/^\/waivers\/client\/[^/]+\/status$/.test(p)) return json({ has_version: false, signed_latest: false, history: [] });
    if (/^\/programs\/(workout|program)-assignments\/client\/[^/]+$/.test(p)) return json([]);
    if (/^\/workout-logs\/client\/[^/]+$/.test(p)) return json(url.searchParams.get('paged') === '1' ? { logs: [], next_cursor: null } : []);
    if (p === '/exercise-media/library-status') return json(STATUS);
    if (p === '/exercise-media/capabilities') return json(CAPS);
    const revisions = p.match(/^\/exercise-media\/exercises\/([^/]+)\/revisions$/);
    if (revisions) {
      const exercise = LIBRARY.find((e) => e.id === revisions[1]);
      return json({ exercise: { id: exercise.id, name: exercise.name, equipment: exercise.equipment, category: exercise.category, primary_muscle: exercise.primary_muscle, hidden: false }, current: null, current_version: 0, drafts: exercise.id === 'lib-wall' ? [DRAFT] : [], next_before: null });
    }
    if (p === '/exercise-media/links') {
      const body = request.postDataJSON();
      return json({ links: body.assets.map(({ asset_id: id }) => ({ asset_id: id, url: `/api/exercise-media/content/${id}.visual`, expires_at: new Date(Date.now() + 60_000).toISOString() })), missing: [] });
    }
    const content = p.match(/^\/exercise-media\/content\/([^.]+)\.visual$/);
    if (content && POSTERS[content[1]]) {
      if (failPoster && content[1] === 'poster-goblet') return route.fulfill({ status: 403, contentType: 'application/json', body: '{"code":"link_expired"}' });
      return route.fulfill({ status: 200, contentType: 'image/jpeg', body: fs.readFileSync(path.join(ASSETS, POSTERS[content[1]])) });
    }
    // ClientDetail tabs this capture does not exercise read as empty lists.
    if (request.method() === 'GET' && role === 'coach' && /^\/(sessions|notes|resources|notifications|clients\/client-1\/)/.test(p)) { unmocked.push(`${test.info().project.name} GET ${p}`); return json([]); }
    unmocked.push(`${test.info().project.name} ${request.method()} ${p} (404)`);
    return json({ error: `visual capture: unmocked ${request.method()} ${p}` }, 404);
  });
}

// Frames an element just below the fixed app header, whether the tracker
// scrolls its own region or (short/narrow windows) the document.
async function frame(locator) {
  // Focus restoration after a dialog closes can scroll late: settle first, then
  // position, and repeat until the element's top stops moving.
  let last = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await locator.page().evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await position(locator);
    const top = await locator.evaluate((el) => Math.round(el.getBoundingClientRect().top));
    if (top === last) return;
    last = top;
  }
}
async function position(locator) {
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
  const dir = variant === 'baseline' ? process.env.CVF_GUIDES_BASELINE_DIR : ROOT;
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
  return { commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), tracked_changes: git('status', '--porcelain', '--untracked-files=no', '--', '.', ':(exclude)docs/exercise-guides/visual-review').split('\n').filter(Boolean) };
}
const box = (page, selector) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
}, selector);
async function shot(page, state, width, height, note) {
  const variant = test.info().project.name;
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const name = `${state}-${variant}-${width}x${height}.png`;
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false, animations: 'disabled' });
  const metrics = {
    scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth), innerWidth: width,
    dock: await box(page, '[data-testid="workout-control-dock"]'), firstSetInput: await box(page, '[data-testid="tracker-exercise-card"] input'), player: await box(page, '[data-testid="exercise-demo-player"]'),
    facade: await box(page, '[data-testid="exercise-demo-facade"]'), dialog: await box(page, '[data-testid="exercise-demo-dialog"]'),
    focused: await page.evaluate(() => document.activeElement?.getAttribute('data-testid') || document.activeElement?.tagName || null),
    providerRequests: page.cvfProvider.length,
  };
  const bytes = fs.readFileSync(file);
  manifest.push({ file: `images/${name}`, state, variant, viewport: { width, height }, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, note, metrics, source: source(variant) });
  return metrics;
}

test.afterAll(() => {
  fs.mkdirSync(METRICS, { recursive: true });
  fs.writeFileSync(path.join(METRICS, `${test.info().project.name}.json`), `${JSON.stringify({ manifest, unmocked }, null, 2)}\n`);
});

for (const [width, height] of VIEWPORTS) {
  test(`tracker and demo dialog at ${width}x${height}`, async ({ page }) => {
    const proposed = test.info().project.name === 'proposed';
    await page.setViewportSize({ width, height });
    await mock(page, 'client');
    await page.goto('/client/workouts/vis-log/track');
    const cards = page.getByTestId('tracker-exercise-card');
    await expect(cards.first()).toBeVisible({ timeout: 45_000 });
    await expect.poll(() => page.getByTestId('exercise-media-poster').first().evaluate((img) => img.complete && img.naturalWidth)).toBe(640);
    await shot(page, 'tracker-top', width, height, 'Active exercise: photo + cues. Baseline opens every link externally; proposed shows View demo for a YouTube link.');
    expect(page.cvfProvider, 'no provider traffic before Play').toEqual([]);
    if (proposed) {
      await page.keyboard.press('Tab');
      await cards.first().getByTestId('tracker-exercise-demo').focus();
      await shot(page, 'tracker-demo-focus', width, height, 'Keyboard focus on View demo (focus ring, 44px target).');
      await page.keyboard.press('Enter');
      const dialog = page.getByTestId('exercise-demo-dialog');
      await expect.poll(() => dialog.getByTestId('exercise-demo-poster').evaluate((img) => img.complete && img.naturalWidth)).toBe(640);
      await shot(page, 'demo-dialog-facade', width, height, 'Demo dialog before Play: first-party photo, cues and notice only. Zero provider requests.');
      expect(page.cvfProvider).toEqual([]);
      await dialog.getByTestId('exercise-demo-play').click();
      await expect(dialog.getByTestId('exercise-demo-iframe')).toHaveCount(1);
      await expect(dialog.getByTestId('exercise-demo-status')).toContainText('Player ready');
      const m = await shot(page, 'demo-dialog-player', width, height, 'After Play: one privacy-enhanced player (stub page here, not YouTube) at least 200x200; Open on YouTube stays.');
      expect(m.player.width).toBeGreaterThanOrEqual(200);
      expect(m.player.height).toBeGreaterThanOrEqual(200);
      expect(m.scrollWidth).toBeLessThanOrEqual(width);
      await page.keyboard.press('Escape');
      await expect(page.locator('iframe')).toHaveCount(0);
      await expect(cards.first().getByTestId('tracker-exercise-demo')).toBeFocused();
    }
    await frame(cards.nth(2));
    await shot(page, 'tracker-external-card', width, height, 'Generic (non-YouTube) link: unchanged External video link that opens a new tab.');
    await frame(cards.nth(3));
    await shot(page, 'tracker-long-name', width, height, 'Long name, legacy YouTube link, no photo: proposed View demo; baseline external link.');
  });

  test(`history, client programs and coach editors at ${width}x${height}`, async ({ page }) => {
    const proposed = test.info().project.name === 'proposed';
    await page.setViewportSize({ width, height });
    await mock(page, 'client');
    await page.goto('/client/workouts/vis-done');
    await expect(page.getByText('Synthetic Goblet Squat').first()).toBeVisible({ timeout: 45_000 });
    await shot(page, 'history-detail', width, height, 'Completed workout: proposed "Current demo" (today\'s demo, labelled as not a historical record).');
    if (proposed) {
      await page.getByTestId('history-current-demo').first().click();
      await expect(page.getByTestId('exercise-demo-dialog')).toContainText('not a record of what was shown');
      await shot(page, 'history-demo-dialog', width, height, 'History demo dialog: labelled current demo, not what was shown during the workout.');
      await page.keyboard.press('Escape');
    }
    await page.goto('/client/programs?view=other');
    const card = page.getByTestId('client-workout-assignment-card');
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: /Exercises/ }).click();
    await expect(card.getByTestId('client-exercise-row').first()).toBeVisible();
    await frame(card);
    await shot(page, 'client-programs', width, height, 'Assigned workout exercise list: proposed Demo action for YouTube links, Video for other links.');
    if (proposed) {
      await card.getByTestId('client-exercise-demo').first().click();
      await expect(page.getByTestId('exercise-demo-facade')).toBeVisible();
      await shot(page, 'client-programs-dialog', width, height, 'Demo dialog from the plan view: no photo context, exercise name facade.');
      await page.keyboard.press('Escape');
    }

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await mock(page, 'coach');
    await page.goto('/coach/programs');
    await page.getByTestId('training-builder-tab-workouts').click();
    // Desktop (lg) selects from the rail into the editor pane; phones edit from cards.
    if (width >= 1024) await page.getByTestId('workout-rail').getByText('Synthetic guides session').click();
    else await page.getByTestId('workout-card').filter({ hasText: 'Synthetic guides session' }).getByTestId('workout-edit-button').click();
    const rows = page.getByTestId('workout-exercise-row');
    await expect(rows.first()).toBeVisible();
    const open = async (index) => {
      const trigger = rows.nth(index).locator('h3 button');
      if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
      const field = rows.nth(index).getByTestId(proposed ? 'workout-exercise-demo' : 'workout-exercise-video-input');
      await field.scrollIntoViewIfNeeded();
      await field.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      return field;
    };
    await open(0);
    await shot(page, 'coach-workout-library-demo', width, height, 'Library exercise: proposed "Use library demo" (followed live, nothing copied); baseline copies the library URL into the row.');
    await open(1);
    await shot(page, 'coach-workout-custom-demo', width, height, 'Explicit custom link for this workout (override); library changes do not update it.');
    await open(2);
    await shot(page, 'coach-workout-legacy-demo', width, height, 'Saved link from before inheritance: labelled Legacy, kept as is until the coach chooses.');
    await page.keyboard.press('Escape');

    await page.goto('/coach/clients/client-1?tab=programs');
    await page.getByTestId('assign-program-button').click();
    await page.getByTestId('client-assignment-type-select').click();
    await page.getByRole('option', { name: 'Quick session' }).click();
    await expect(page.getByTestId('quick-session-builder')).toBeVisible();
    await page.getByTestId('quick-session-exercise-name-input').first().fill('Synthetic Goblet Squat');
    await page.getByTestId('quick-session-more-button').first().click();
    const more = page.getByTestId('quick-session-more-fields').first();
    await (proposed ? more.getByTestId('quick-session-exercise-demo') : more.getByTestId('quick-session-exercise-notes-input')).evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await shot(page, 'coach-quick-demo', width, height, 'Quick session row, More: proposed library-demo choice (Quick v1 body unchanged); baseline has no demo control.');
    await page.keyboard.press('Escape');

    await page.goto('/coach/programs');
    await page.getByTestId('exercise-library-card').filter({ hasText: 'Synthetic Wall Sit' }).getByTestId('exercise-library-media-button').click();
    const editor = page.getByTestId('exercise-media-editor');
    await expect(editor.getByTestId('media-draft-editor')).toBeVisible();
    await editor.getByTestId('media-file-source_image').evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await shot(page, 'coach-media-photos', width, height, 'Draft guide: proposed photo-first (no video upload in the default photos mode) with the optional still-from-clip; baseline offers video upload.');
    if (proposed) {
      await editor.getByTestId('media-still-open').click();
      await editor.getByTestId('media-still-file').setInputFiles(CLIP);
      await expect(editor.getByTestId('media-still-time')).toBeVisible();
      await editor.getByTestId('media-still-time').fill('1.0');
      await editor.getByTestId('media-still-time').press('Enter');
      await editor.getByTestId('media-still-use').click();
      await expect(editor.getByTestId('media-still-confirmed')).toBeVisible();
      await editor.getByTestId('media-still-confirmed').evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await shot(page, 'coach-still-confirmed', width, height, 'Local still selection: only the chosen frame is uploaded; the clip stays on this device.');
    }
  });
}

test('proposed player states at 320x740: loading, embed refused (150), script blocked, photo unavailable', async ({ page }) => {
  test.skip(test.info().project.name !== 'proposed', 'proposed-only states');
  await page.setViewportSize({ width: 320, height: 740 });
  const open = async (options) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await mock(page, 'client', options);
    await page.goto('/client/workouts/vis-log/track');
    await page.getByTestId('tracker-exercise-card').first().getByTestId('tracker-exercise-demo').click();
    return page.getByTestId('exercise-demo-dialog');
  };
  let dialog = await open({ ytMode: 'silent' });
  await dialog.getByTestId('exercise-demo-play').click();
  await expect(dialog.getByTestId('exercise-demo-status')).toContainText('Loading the YouTube player');
  await shot(page, 'demo-dialog-loading', 320, 740, 'Slow player: calm status (spinner static under reduced motion); Open on YouTube stays.');
  dialog = await open({ ytMode: '150' });
  await dialog.getByTestId('exercise-demo-play').click();
  await expect(dialog.getByTestId('exercise-demo-error')).toBeVisible();
  await shot(page, 'demo-dialog-error-150', 320, 740, 'Embedding refused (101/150): cause, Try again and Open on YouTube.');
  dialog = await open({ apiBlocked: true });
  await dialog.getByTestId('exercise-demo-play').click();
  await expect(dialog.getByTestId('exercise-demo-status')).toContainText('controls are limited', { timeout: 15_000 });
  await shot(page, 'demo-dialog-limited', 320, 740, 'IFrame API blocked: player still mounted, honest limited-controls note, external fallback.');
  dialog = await open({ failPoster: true });
  await expect(dialog.getByTestId('exercise-demo-facade')).toContainText('Synthetic Goblet Squat');
  await shot(page, 'demo-dialog-photo-unavailable', 320, 740, 'Photo link expired: the facade shows the exercise name; Play still works.');
});

test('proposed refinement: 200% zoom dialog and short keyboard viewport', async ({ page }) => {
  test.skip(test.info().project.name !== 'proposed', 'proposed-only refinement evidence');
  await page.setViewportSize({ width: 640, height: 450 });
  await mock(page, 'client');
  await page.goto('/client/workouts/vis-log/track');
  await page.getByTestId('tracker-exercise-card').first().getByTestId('tracker-exercise-demo').click();
  await page.getByTestId('exercise-demo-play').click();
  await expect(page.getByTestId('exercise-demo-status')).toContainText('Player ready');
  const m = await shot(page, 'refine-zoom200-player', 640, 450, '1280x900 at 200% zoom (640x450 CSS px): dialog scrolls, player stays at least 200x200, no overflow.');
  expect(m.player.width).toBeGreaterThanOrEqual(200);
  expect(m.player.height).toBeGreaterThanOrEqual(200);
  expect(m.scrollWidth).toBeLessThanOrEqual(640);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 420 });
  const weight = page.getByTestId('tracker-exercise-card').first().getByRole('spinbutton', { name: /set 1 weight/ });
  await weight.focus();
  await page.waitForTimeout(300);
  await shot(page, 'refine-keyboard-short', 390, 420, 'Short (keyboard-open) viewport: the focused weight input stays above the pinned timer/Finish controls.');
  const input = await weight.boundingBox();
  const dock = await page.getByTestId('workout-control-dock').boundingBox();
  expect(input.y + input.height <= dock.y || input.y >= dock.y + dock.height).toBe(true);
});
