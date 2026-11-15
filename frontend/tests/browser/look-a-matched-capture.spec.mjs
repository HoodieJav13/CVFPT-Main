// Scene-for-scene recapture of the original fb0c8dd baseline set
// (task-7/look-a-baseline-capture/capture.mjs: same fixture module, same
// fictional history/dashboard/attention payloads, same fixed clock, viewports,
// actions and file names) on THIS source, so before/after compare 1:1.
// Differences from the baseline harness: runs on the project's own Vite
// config through playwright.look-a.config.mjs (port 42800; 42761 is not used),
// and the Look A routes this source calls (GET /undo) answer from the shared
// fixture. Writes PNGs and manifest.json to CAPTURE_DIR. Fictional data only.
// Run: LOOK_A_SPECS='look-a-matched-capture.spec.mjs' CAPTURE_DIR=<abs dir> npx playwright test --config playwright.look-a.config.mjs
import { test, expect } from '@playwright/test';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setupWorkoutUx, exerciseName } from './workout-ux-fixture.mjs';

const OUT = process.env.CAPTURE_DIR;
const manifest = { source: process.env.CAPTURE_SOURCE || null, fixedNow: '2026-11-14T16:00:00.000Z', captures: [] };
const history = { occurrences: [{ workout_log_id: 'synthetic-prior', completed_at: '2026-11-07T16:00:00.000Z', exercise_name: exerciseName, tracking_type: 'reps_weight', sets: [{ set_number: 1, status: 'completed', actual_load_value: 60, actual_load_unit: 'kg', actual_reps: 8, actual_rpe: 7 }, { set_number: 2, status: 'completed', actual_load_value: 135.5, actual_load_unit: 'lb', actual_reps: 8, actual_rpe: null }] }], next_cursor: null };
const dashboard = { today_sessions: [{ id: 'synthetic-session', client: { name: 'Fictional Avery' }, scheduled_at: '2026-11-14T17:00:00.000Z', duration_minutes: 45, status: 'scheduled', location: 'Training floor' }], client_count: 3, pending_bookings: [], unread_messages: 0, stale_sessions: [], recent_messages: [], recent_check_ins: [] };
const attention = { coverage: { complete: true }, attention: [{ client_id: 'synthetic-avery', client_name: 'Fictional Avery', reasons: [{ code: 'low_adherence', label: '1 of 3 assigned workouts completed' }] }] };
const sha = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');

test.beforeAll(async () => { if (OUT) await mkdir(`${OUT}/screenshots`, { recursive: true }); });
test.afterAll(async () => { if (OUT) await writeFile(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2)); });

const SCENES = [
  ...[{ width: 375, height: 667 }, { width: 390, height: 844 }, { width: 320, height: 700 }, { width: 1440, height: 900 }]
    .flatMap((viewport) => ['fresh', 'logged-rest'].map((state) => ({ viewport, state, role: 'client' }))),
  { viewport: { width: 1440, height: 900 }, state: 'dashboard', role: 'coach' },
  ...['draft', 'history', 'offline'].map((state) => ({ viewport: { width: 390, height: 844 }, state, role: 'client' })),
];

for (const { viewport, state, role } of SCENES) {
  test(`${role} ${state} ${viewport.width}x${viewport.height}`, async ({ browser }) => {
    test.skip(!OUT, 'CAPTURE_DIR not set');
    const entry = { viewport, state, role, actions: [] };
    const context = await browser.newContext({ viewport, baseURL: test.info().project.use.baseURL, colorScheme: 'dark', locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce', serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.addInitScript(() => { Date.now = () => 1794672000000; localStorage.setItem('theme', 'dark'); });
    const { fixture, results } = await setupWorkoutUx(page, role);
    fixture.log.started_at = '2026-11-14T15:55:00.000Z';
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
      const json = (value) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
      if (/^\/workout-logs\/ux-log\/exercises\/[^/]+\/cue-retry$/.test(path)) return json({ incoming: [], outgoing: [], can_create: false, can_recheck: false, source_version: null });
      if (/^\/workout-logs\/ux-log\/exercises\/[^/]+\/history$/.test(path)) return json(state === 'history' ? history : { occurrences: [], next_cursor: null });
      if (path === '/workout-logs/ux-log/undo' && route.request().method() === 'GET') return json({ undo: null });
      if (path === '/dashboard/coach') return json(dashboard);
      if (path === '/analytics/coach') return json(attention);
      return route.fallback();
    });
    const url = role === 'coach' ? '/coach' : '/client/workouts/ux-log/track';
    entry.route = url;
    await page.goto(url);
    await page.getByTestId(role === 'coach' ? 'coach-action-queue' : 'workout-tracker').waitFor();
    await page.evaluate(() => document.fonts.ready);
    if (state === 'logged-rest') {
      await page.getByRole('button', { name: 'Complete set 1', exact: true }).first().click();
      await page.getByRole('button', { name: 'Complete set 1', exact: true }).first().click();
      await page.getByTestId('rest-timer').waitFor();
      entry.actions.push('Click Complete set 1 on first exercise, then superset partner; rest timer appears.');
    }
    if (state === 'draft' || state === 'offline') {
      if (state === 'offline') {
        // The dev server loads LocalCueRetry lazily; load it before cutting the network.
        await page.evaluate((chunk) => import(chunk), '/src/components/training/LocalCueRetry.jsx');
        await context.setOffline(true);
        entry.actions.push('Set browser context offline after initial app load.');
      }
      const input = page.getByLabel(`${exerciseName} set 1 weight`, { exact: true });
      await input.fill('140');
      if (state === 'offline') { await input.blur(); await page.getByText('Not saved yet', { exact: false }).first().waitFor(); entry.actions.push('Enter 140 lb and blur; local unsaved state.'); }
      else entry.actions.push('Enter 140 lb in first weight field; leave field focused as draft.');
    }
    if (state === 'history') {
      const card = page.getByTestId('tracker-exercise-card').first();
      await card.getByRole('button', { name: 'History & notes', exact: true }).click();
      await card.getByRole('button', { name: 'Exercise history', exact: true }).click();
      await card.getByTestId('exercise-history').getByText('60 kg', { exact: false }).first().waitFor();
      await card.getByTestId('exercise-history').evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
      entry.actions.push('Open first exercise History & notes, then Exercise history; show fictional mixed-unit prior sets.');
    }
    if (state !== 'history') await page.evaluate(() => { scrollTo(0, 0); const r = document.querySelector('[data-testid="workout-scroll-region"]'); if (r) r.scrollTop = 0; });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const file = `screenshots/${role}-${state}-${viewport.width}x${viewport.height}.png`;
    await page.screenshot({ path: `${OUT}/${file}`, animations: 'disabled' });
    entry.file = file; entry.sha256 = await sha(`${OUT}/${file}`);
    entry.documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    if (role === 'client' && ['fresh', 'logged-rest'].includes(state)) {
      const active = page.locator('[data-set-id][data-active="true"]').first();
      if (await active.count()) {
        await active.evaluate((e) => e.scrollIntoView({ block: 'start', behavior: 'instant' }));
        entry.activeSetFile = file.replace('.png', '-active-set.png');
        await page.screenshot({ path: `${OUT}/${entry.activeSetFile}`, animations: 'disabled' });
        entry.activeSetSha256 = await sha(`${OUT}/${entry.activeSetFile}`);
      }
    }
    if (role === 'coach') {
      entry.fullPage = file.replace('.png', '-full.png');
      await page.screenshot({ path: `${OUT}/${entry.fullPage}`, fullPage: true, animations: 'disabled' });
      entry.fullPageSha256 = await sha(`${OUT}/${entry.fullPage}`);
    }
    entry.writes = results.writes; entry.errors = results.errors; entry.unexpectedApi = results.unexpected;
    manifest.captures.push(entry);
    await context.close();
    expect(results.errors).toEqual([]);
    expect(results.unexpected).toEqual([]);
  });
}
