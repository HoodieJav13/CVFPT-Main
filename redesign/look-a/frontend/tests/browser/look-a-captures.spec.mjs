// Matched synthetic captures for the Look A visual port (before/after on the
// same fictional fixtures). Not a regression suite: it records screenshots to
// CAPTURE_DIR and checks only that each state rendered without page errors.
// Run: LOOK_A_SPECS='look-a-captures.spec.mjs' CAPTURE_DIR=<abs dir> npx playwright test --config playwright.look-a.config.mjs
// Normal mode, synthetic API only, fictional data only, headless.
import { test, expect } from '@playwright/test';
import { makeServer, installServer, card, settled, undoButton, open } from './look-a-server.mjs';

const OUT = process.env.CAPTURE_DIR;
const LOG = 'capture-log';
const row = (exercise, n, extra = {}) => ({
  id: `${exercise}-s${n}`, workout_log_exercise_id: exercise, set_number: n, status: 'pending', set_origin: 'prescribed',
  actual_load_value: null, actual_load_unit: 'lb', actual_reps: null, actual_rpe: null,
  actual_duration_value: null, actual_duration_unit: null, actual_distance_value: null, actual_distance_unit: null,
  revision: 0, last_actor_role: null, value_origin: 'unknown', value_origin_nonce: null, archived: false,
  updated_at: '2026-11-14T11:00:00.000Z', ...extra,
});
const exercise = (id, name, sets, extra = {}) => ({
  id, exercise_name: name, tracking_type: 'reps_weight', prescribed_sets: String(sets.length), prescribed_reps: '4-6',
  prescribed_rest_seconds: 90, superset_group: null, plan_revision: 0, backups: [], not_set_tracked: false, sets, ...extra,
});
const fixtureLog = () => ({
  id: LOG, client_id: 'capture-client', workout_name: 'Lower A', status: 'active', started_at: '2026-11-14T15:00:00.000Z', not_set_tracked: false,
  exercises: [
    exercise('a', 'Back Squat', [
      row('a', 1, { status: 'completed', actual_load_value: 170, actual_reps: 4, revision: 2, last_actor_role: 'client', value_origin: 'entered' }),
      row('a', 2, { actual_load_value: 170, value_origin: 'prefill', prefill_load_value: 170, prefill_load_unit: 'lb' }),
      row('a', 3, { actual_load_value: 170, value_origin: 'prefill', prefill_load_value: 170, prefill_load_unit: 'lb' }),
    ], { prescribed_load_value: 170, prescribed_load_max: 180, prescribed_load_unit: 'lb', prescribed_notes: 'Slow lower, tall chest.' }),
    exercise('b', 'Single-leg RDL', [1, 2, 3].map((n) => row('b', n)), { prescribed_reps: '8', prescribed_load_value: 35, prescribed_load_unit: 'lb', per_side: true }),
    exercise('c', 'Cable Row', [1, 2, 3].map((n) => row('c', n)), { prescribed_reps: '10', prescribed_load_value: 40, prescribed_load_unit: 'lb' }),
  ],
  coach_responses: [], conflicts: [], substitutions: [],
});
const HISTORY = {
  a: [{ id: 'occ-a', workout_log_id: 'past', tracking_type: 'reps_weight', completed_at: '2026-11-07T18:00:00.000Z', sets: [
    { set_number: 1, actual_load_value: 170, actual_load_unit: 'lb', actual_reps: 4 },
    { set_number: 2, actual_load_value: 170, actual_load_unit: 'lb', actual_reps: 4 },
    { set_number: 3, actual_load_value: 165, actual_load_unit: 'lb', actual_reps: 4 },
  ] }],
};

async function tracker(page) {
  const server = makeServer(fixtureLog());
  const results = await installServer(page, server, { logId: LOG, profile: 'Rae M.' });
  await page.route(new RegExp(`/api/workout-logs/${LOG}/exercises/([^/]+)/history`), (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-2);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ occurrences: HISTORY[id] || [], next_cursor: null }) });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, LOG);
  return { server, results };
}
const shot = async (page, name, fullPage = false) => {
  test.skip(!OUT, 'CAPTURE_DIR not set');
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
};

for (const [w, h] of [[375, 667], [390, 844], [320, 700]]) {
  test(`tracker ${w}x${h}: fresh, inline adjust, Done (outlined tick + Undo), Finish dialog`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    const { results } = await tracker(page);
    await expect(page.getByTestId('set-last-time').first()).toBeVisible();
    await shot(page, `tracker-01-fresh-${w}x${h}`);
    // "I did something different": the set's editor opens inside the Focus panel.
    await page.getByTestId('focus-adjust').click();
    await expect(page.getByTestId('focus-editor')).toBeVisible();
    // No harness scrolling: this is where the tracker itself puts the editor and Log.
    await page.waitForTimeout(100);
    const whole = await page.getByTestId('focus-log').evaluate((e) => {
      const r = e.getBoundingClientRect(); const region = document.querySelector('[data-testid="workout-scroll-region"]').getBoundingClientRect();
      const dock = document.querySelector('[data-testid="workout-control-dock"]').getBoundingClientRect();
      return r.top >= region.top - 1 && r.bottom <= Math.min(region.bottom, dock.top) + 1;
    });
    expect(whole, 'the whole Log action is in view when the editor opens').toBe(true);
    await expect(page.getByTestId('focus-editor').locator('input').first()).toBeFocused();
    await shot(page, `tracker-01b-adjust-${w}x${h}`);
    await card(page, 'Single-leg RDL').getByTestId('exercise-quick-complete').click();
    await settled(page, LOG);
    await expect(undoButton(page)).toBeVisible();
    await shot(page, `tracker-02-done-undo-${w}x${h}`);
    await page.getByTestId('workout-outline').scrollIntoViewIfNeeded();
    await shot(page, `tracker-03-outline-${w}x${h}`);
    await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await shot(page, `tracker-04-finish-${w}x${h}`);
    expect(results.errors).toEqual([]);
  });
}

test('tracker 390x844 at 200% text', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { results } = await tracker(page);
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await shot(page, 'tracker-05-text200-390x844');
  const offenders = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > width + 1 && getComputedStyle(el).position !== 'fixed')
      .filter((el) => !el.closest('[data-sonner-toaster]')).slice(0, 8)
      .map((el) => `${el.tagName}.${String(el.className).slice(0, 60)} [${el.getAttribute('data-testid') || ''}] r=${Math.round(el.getBoundingClientRect().right)}`);
  });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, offenders.join('\n')).toBeLessThanOrEqual(0);
  expect(results.errors).toEqual([]);
});

// Enlarged text is usable, not just unclipped: at 200% the Focus Log, the
// inline editor and Finish can each be brought fully into view by scrolling,
// and with a phone keyboard open (simulated by a shorter window) the focused
// field and then Log stay reachable. "Whole" = inside the window and not under
// the pinned dock (when the dock is pinned).
const wholeInView = (locator) => locator.evaluate((e) => {
  const r = e.getBoundingClientRect();
  const dock = document.querySelector('[data-testid="workout-control-dock"]');
  const pinned = dock && dock.contains(e) ? null : dock?.getBoundingClientRect();
  const bottom = pinned && pinned.top < innerHeight && pinned.top > 0 ? Math.min(innerHeight, pinned.top) : innerHeight;
  return r.height > 0 && r.top >= -1 && r.bottom <= bottom + 1;
});
const userScrollTo = (locator) => locator.evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'instant' }));

test('tracker 390x844 at 200% text: Log, inline editor, keyboard and Finish stay reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { results } = await tracker(page);
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await page.waitForTimeout(200);
  const log = page.getByTestId('focus-log');
  await userScrollTo(log);
  expect(await wholeInView(log), 'Log whole after scrolling').toBe(true);
  await shot(page, 'tracker-06-text200-log-390x844');
  await userScrollTo(page.getByTestId('focus-adjust'));
  await page.getByTestId('focus-adjust').click();
  const input = page.getByTestId('focus-editor').locator('input').first();
  await expect(input).toBeFocused();
  await page.waitForTimeout(200);
  expect(await wholeInView(input), 'focused field whole when the editor opens').toBe(true);
  await userScrollTo(log);
  expect(await wholeInView(log), 'Log whole with the editor open').toBe(true);
  await shot(page, 'tracker-07-text200-adjust-390x844');
  // Phone keyboard: the visible window shrinks while the field is focused.
  await input.focus();
  await page.setViewportSize({ width: 390, height: 460 });
  await page.waitForTimeout(250);
  expect(await wholeInView(input), 'focused field whole with the keyboard open').toBe(true);
  await shot(page, 'tracker-08-text200-keyboard-390x460');
  await userScrollTo(log);
  expect(await wholeInView(log), 'Log reachable with the keyboard open').toBe(true);
  await shot(page, 'tracker-08b-text200-keyboard-log-390x460');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const finish = page.getByRole('button', { name: 'Finish workout', exact: true });
  await userScrollTo(finish);
  expect(await finish.evaluate((e) => { const r = e.getBoundingClientRect(); return r.top >= -1 && r.bottom <= innerHeight + 1; }), 'Finish whole').toBe(true);
  await shot(page, 'tracker-09-text200-finish-390x844');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(results.errors).toEqual([]);
});

// ---------- coach dashboard (fictional clients, real response shapes) ----------
const NOW = new Date('2026-11-14T17:00:00.000Z');
const DASHBOARD = {
  today_sessions: [{ id: 'cap-s1', scheduled_at: '2026-11-14T23:00:00.000Z', duration_minutes: 60, status: 'scheduled', location: 'Floor', client: { name: 'Fictional T. A.' } }],
  client_count: 9,
  pending_bookings: [{ id: 'cap-b1', client_id: 'cap-c1', requested_time: '2026-11-16T16:00:00.000Z', duration_minutes: 60, note: 'Morning works best', client: { name: 'Fictional D. K.' } }],
  unread_messages: 1,
  recent_messages: [{ client_id: 'cap-c2', sender_role: 'client', read_by_recipient: false, content: 'Can we move Thursday?', client: { name: 'Fictional S. V.' } }],
  recent_check_ins: [{ id: 'cap-ci1', client_id: 'cap-c3', energy: 4, sleep_quality: 3, client: { name: 'Fictional J. O.' } }],
  stale_sessions: [],
};
const ATTENTION = [
  { client_id: 'cap-c4', client_name: 'Fictional P. N.', reasons: [{ code: 'low_adherence', label: '1 of 4 workouts completed' }, { code: 'no_check_in', label: 'No check-in in 16 days' }] },
  { client_id: 'cap-c5', client_name: 'Fictional L. H.', reasons: [{ code: 'session_gap', label: 'No session in 19 days' }] },
];

async function coach(page, { analytics = true } = {}) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(() => localStorage.setItem('cvf_access_token', 'synthetic-coach-capture'));
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/auth/me') return json({ role: 'coach', email: 'coach@example.invalid', id: 'cap-coach', profile: { id: 'cap-coach', name: 'Fictional Coach' } });
    if (path === '/telemetry/events') return route.fulfill({ status: 204 });
    if (path === '/dashboard/coach') return json(DASHBOARD);
    if (path === '/analytics/coach') return analytics ? json({ coverage: { complete: true }, attention: ATTENTION }) : json({ error: 'Synthetic analytics failure' }, 503);
    if (path.endsWith('/unread-count')) return json({ unread: 1 });
    return json([]);
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/coach');
  await expect(page.getByTestId('coach-action-queue')).toBeVisible();
  return errors;
}

for (const [w, h] of [[1440, 900], [390, 844]]) {
  test(`coach queue ${w}x${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    const errors = await coach(page);
    await page.getByTestId('coach-action-queue').scrollIntoViewIfNeeded();
    await shot(page, `coach-01-queue-${w}x${h}`, true);
    expect(errors).toEqual([]);
  });
}

test('coach queue 1440x900 with trend signals unavailable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await coach(page, { analytics: false });
  await expect(page.getByTestId('coach-queue-partial-note')).toBeVisible();
  await shot(page, 'coach-02-partial-1440x900', true);
  expect(errors).toEqual([]);
});
