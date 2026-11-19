// Normal tracker: per-exercise quick complete and its six-second Undo restore
// the whole previous state (owner decision 2026-11-12: "keep the 6-second
// Undo; Undo restores everything as it was, skipped sets included"). Normal
// mode, synthetic in-process API, fictional data only. A mixed exercise has a
// completed set, a typed set, an untouched prefilled set and a skipped set.
// This proves UI behaviour and the writes the page sends, not server
// authorization or database rules.
import { test, expect } from '@playwright/test';

const LOG = 'undo-log';
const REST_KEY = `cvf_rest_timer_${LOG}`;
const row = (exercise, n, extra = {}) => ({
  id: `${exercise}-s${n}`, workout_log_exercise_id: exercise, set_number: n, status: 'pending', set_origin: 'prescribed',
  actual_load_value: 50, actual_load_unit: 'lb', actual_reps: null, actual_rpe: null,
  actual_duration_value: null, actual_duration_unit: null, actual_distance_value: null, actual_distance_unit: null,
  revision: 0, last_actor_role: null, ...extra,
});
const fixtureLog = () => ({
  id: LOG, client_id: 'undo-client', workout_name: 'Fictional undo workout', status: 'active', started_at: new Date().toISOString(),
  exercises: [
    { id: 'a', exercise_name: 'Incline Press', tracking_type: 'reps_weight', prescribed_sets: '4', prescribed_reps: '8', prescribed_load_value: 50, prescribed_load_unit: 'lb', prescribed_rest_seconds: 90, superset_group: null, plan_revision: 0, backups: [],
      sets: [row('a', 1, { status: 'completed', actual_reps: 8, revision: 2, last_actor_role: 'client' }), row('a', 2), row('a', 3), row('a', 4, { status: 'skipped', actual_load_value: null, actual_load_unit: null, revision: 1 })] },
    { id: 'b', exercise_name: 'Goblet Squat', tracking_type: 'reps_weight', prescribed_sets: '3', prescribed_reps: '10', prescribed_load_value: 35, prescribed_load_unit: 'lb', prescribed_rest_seconds: 60, superset_group: null, plan_revision: 0, backups: [],
      sets: [row('b', 1, { actual_load_value: 35 }), row('b', 2, { actual_load_value: 35 }), row('b', 3, { actual_load_value: 35 })] },
    { id: 'c', exercise_name: 'Cable Row', tracking_type: 'reps_weight', prescribed_sets: '3', prescribed_reps: '12', prescribed_load_value: 40, prescribed_load_unit: 'lb', prescribed_rest_seconds: 60, superset_group: null, plan_revision: 0, backups: [],
      sets: [row('c', 1, { actual_load_value: 40 }), row('c', 2, { actual_load_value: 40 }), row('c', 3, { actual_load_value: 40 })] },
  ],
  coach_responses: [], conflicts: [], substitutions: [],
});
const SET_FIELDS = ['status', 'actual_load_value', 'actual_load_unit', 'actual_reps', 'actual_rpe'];
const pick = (set) => Object.fromEntries(SET_FIELDS.map((key) => [key, set[key] ?? null]));

async function setup(page, { width = 390, height = 844, alerts = false } = {}) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const server = fixtureLog();
  const results = { errors: [], unexpected: [], writes: [] };
  page.on('pageerror', (error) => results.errors.push(error.message));
  await page.addInitScript((on) => {
    localStorage.setItem('cvf_access_token', 'synthetic-undo-token');
    if (on) localStorage.setItem('cvf_rest_alerts', 'on');
    window.__vibrations = 0;
    navigator.vibrate = () => { window.__vibrations += 1; return true; };
  }, alerts);
  await page.route('**/api/**', async (route) => {
    const r = route.request();
    const path = new URL(r.url()).pathname.replace(/^\/api/, '');
    const method = r.method();
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/auth/me') return json({ role: 'client', email: 'undo@example.invalid', profile: { id: 'undo-client', name: 'Fictional undo client', waiver_signed: true } });
    if (path === '/telemetry/events') return route.fulfill({ status: 204 });
    if (path.endsWith('/unread-count')) return json({ unread: 0 });
    if (path === `/workout-logs/${LOG}` && method === 'GET') return json({ ...server, server_time: new Date().toISOString() });
    if (new RegExp(`^/workout-logs/${LOG}/exercises/[^/]+/history$`).test(path)) return json({ occurrences: [], next_cursor: null });
    if (new RegExp(`^/workout-logs/${LOG}/exercises/[^/]+/substitution-options$`).test(path)) return json({ backups: [], suggestions: [], catalog_reason: null, server_time: new Date().toISOString() });
    if (method === 'GET' && new RegExp(`^/workout-logs/${LOG}/exercises/[^/]+/cue-retry$`).test(path)) return json({ source_version: null, can_create: false, can_recheck: false, outgoing: [], incoming: [] });
    if (method === 'PATCH' && path.startsWith(`/workout-logs/${LOG}/sets/`)) {
      const setId = path.split('/').at(-1);
      const set = server.exercises.flatMap((exercise) => exercise.sets).find((item) => item.id === setId);
      const body = r.postDataJSON();
      results.writes.push({ setId, ...pick(body), base_revision: body.base_revision });
      for (const key of SET_FIELDS) if (key in body) set[key] = body[key];
      set.revision += 1;
      set.last_actor_role = 'client';
      return json({ ...set, event: { outcome: 'applied' } });
    }
    results.unexpected.push(`${method} ${path}`);
    return json({ error: 'Unexpected synthetic route' }, 404);
  });
  await page.goto(`/client/workouts/${LOG}/track`);
  await expect(page.getByTestId('workout-outline')).toBeVisible();
  return { server, results };
}

const card = (page, name) => page.getByTestId('tracker-exercise-card').filter({ has: page.getByText(name, { exact: true }) }).first();
const region = (page) => page.getByTestId('workout-scroll-region');
const restDeadline = (page) => page.evaluate((key) => localStorage.getItem(key), REST_KEY);
// The server copy of each set without its concurrency fields (revision and last actor move on by design).
const serverSets = (server, exerciseId) => server.exercises.find((exercise) => exercise.id === exerciseId).sets.map((set) => {
  const copy = { ...set };
  delete copy.revision;
  delete copy.last_actor_role;
  return copy;
});
const settle = (page) => page.waitForFunction(() => !localStorage.getItem('cvf_workout_outbox_undo-log'));
const quickButton = (page) => card(page, 'Incline Press').getByTestId('exercise-quick-complete');
const quickReason = (page) => card(page, 'Incline Press').getByTestId('exercise-quick-unavailable');

async function typeReps(page, n, value) {
  const input = page.locator(`input[aria-label="Incline Press set ${n} performed reps"]`);
  await input.scrollIntoViewIfNeeded();
  await input.fill(value);
  await input.blur();
}

for (const [width, height] of [[390, 844], [320, 700]]) {
  test(`${width}×${height}: Undo restores the sets, skipped and completed sets untouched, the earlier rest timer, the scroll position and focus`, async ({ page }) => {
    const { server, results } = await setup(page, { width, height });
    await typeReps(page, 2, '4');
    await settle(page);
    const before = serverSets(server, 'a');
    // A rest timer started by the client before the action.
    await page.getByTestId('rest-start').click();
    const deadlineBefore = await restDeadline(page);
    expect(Number(deadlineBefore)).toBeGreaterThan(Date.now());
    const quick = card(page, 'Incline Press').getByTestId('exercise-quick-complete');
    await expect(quick).toHaveText(/Record 2 remaining as entered \(1 with details, 1 without\)/);
    await quick.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    const scrollBefore = await region(page).evaluate((node) => node.scrollTop);
    const cardTopBefore = await card(page, 'Incline Press').evaluate((node) => Math.round(node.getBoundingClientRect().top));
    const windowBefore = await page.evaluate(() => window.scrollY);
    await page.screenshot({ path: test.info().outputPath(`1-before-${width}x${height}.png`) });
    const writesBefore = results.writes.length;

    await quick.click();
    await expect(page.getByTestId('exercise-quick-undo')).toBeVisible();
    await settle(page);
    const deadlineAfter = await restDeadline(page);
    expect(deadlineAfter).not.toBe(deadlineBefore);
    expect(serverSets(server, 'a').map((set) => set.status)).toEqual(['completed', 'completed', 'completed', 'skipped']);
    await page.screenshot({ path: test.info().outputPath(`2-after-quick-${width}x${height}.png`) });

    await page.getByTestId('exercise-quick-undo-button').click();
    await expect(page.getByTestId('exercise-quick-undo')).toHaveCount(0);
    await settle(page);
    // Set data: back exactly as before (server copy and the page), completed and skipped sets never written.
    expect(serverSets(server, 'a')).toEqual(before);
    const undoWrites = results.writes.slice(writesBefore);
    expect(undoWrites.map((w) => `${w.setId}:${w.status}`)).toEqual(['a-s2:completed', 'a-s3:completed', 'a-s2:pending', 'a-s3:pending']);
    await expect(page.locator('input[aria-label="Incline Press set 2 performed reps"]')).toHaveValue('4');
    await expect(page.locator('input[aria-label="Incline Press set 3 weight"]')).toHaveValue('50');
    await expect(page.locator('input[aria-label="Incline Press set 3 performed reps"]')).toHaveValue('');
    await expect(page.locator('[data-set-id="a-s1"] button[aria-label="Mark incomplete set 1"]')).toBeVisible();
    await expect(card(page, 'Incline Press').getByTestId('exercise-quick-complete')).toHaveText(/Record 2 remaining as entered \(1 with details, 1 without\)/);
    // The earlier rest timer, with its original deadline.
    expect(await restDeadline(page)).toBe(deadlineBefore);
    await expect(page.getByTestId('rest-timer')).toHaveAttribute('data-rest-state', 'running');
    // The view: same scroll position, focus back on the control that was used.
    await expect.poll(() => region(page).evaluate((node) => node.scrollTop)).toBeGreaterThanOrEqual(scrollBefore - 1);
    expect(await region(page).evaluate((node) => node.scrollTop)).toBeLessThanOrEqual(scrollBefore + 1);
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - windowBefore)).toBeLessThanOrEqual(1);
    expect(await card(page, 'Incline Press').evaluate((node) => Math.round(node.getBoundingClientRect().top))).toBe(cardTopBefore);
    await expect(card(page, 'Incline Press').getByTestId('exercise-quick-complete')).toBeFocused();
    await page.screenshot({ path: test.info().outputPath(`3-after-undo-${width}x${height}.png`) });
    expect(results.unexpected).toEqual([]);
    expect(results.errors).toEqual([]);
  });
}

test('a newer rest timer started after the action is kept; a double tap on Undo reopens once', async ({ page }) => {
  const { server, results } = await setup(page);
  await card(page, 'Incline Press').getByTestId('exercise-quick-complete').click();
  await settle(page);
  // The client stops the action's timer and starts a new one: newer input.
  await page.getByTestId('rest-timer').click();
  await page.getByTestId('rest-start').click();
  const newer = await restDeadline(page);
  const writesBefore = results.writes.length;
  await page.getByTestId('exercise-quick-undo-button').dblclick();
  await settle(page);
  expect(results.writes.slice(writesBefore).map((w) => `${w.setId}:${w.status}`)).toEqual(['a-s2:pending', 'a-s3:pending']);
  expect(await restDeadline(page)).toBe(newer);
  expect(serverSets(server, 'a').map((set) => set.status)).toEqual(['completed', 'pending', 'pending', 'skipped']);
  expect(results.errors).toEqual([]);
});

test('no timer before the action: Undo removes the timer the action started', async ({ page }) => {
  await setup(page);
  expect(await restDeadline(page)).toBeNull();
  await card(page, 'Incline Press').getByTestId('exercise-quick-complete').click();
  await expect(page.getByTestId('rest-timer')).toBeVisible();
  await page.getByTestId('exercise-quick-undo-button').click();
  await expect(page.getByTestId('rest-timer')).toHaveCount(0);
  expect(await restDeadline(page)).toBeNull();
});

test('an earlier timer that already finished comes back finished, without alerting again', async ({ page }) => {
  await setup(page, { alerts: true });
  await page.getByTestId('rest-start').click();
  // Run the client's timer down to finished with the existing −15 s control.
  for (let i = 0; i < 12 && (await page.getByTestId('rest-minus').count()); i += 1) await page.getByTestId('rest-minus').click();
  await expect(page.getByTestId('rest-timer')).toHaveAttribute('data-rest-state', 'complete');
  await expect.poll(() => page.evaluate(() => window.__vibrations)).toBe(1);
  const finished = await restDeadline(page);
  await card(page, 'Incline Press').getByTestId('exercise-quick-complete').click();
  await expect(page.getByTestId('rest-timer')).toHaveAttribute('data-rest-state', 'running');
  await page.getByTestId('exercise-quick-undo-button').click();
  await expect(page.getByTestId('rest-timer')).toHaveAttribute('data-rest-state', 'complete');
  expect(await restDeadline(page)).toBe(finished);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__vibrations)).toBe(1);
  await expect(page.getByTestId('rest-complete-announcement')).toHaveText('');
});

test('after six seconds Undo is gone and nothing changes; a set changed since refuses Undo and writes nothing', async ({ page }) => {
  const { server, results } = await setup(page);
  await card(page, 'Incline Press').getByTestId('exercise-quick-complete').click();
  await settle(page);
  const afterQuick = serverSets(server, 'a');
  const deadline = await restDeadline(page);
  await page.waitForTimeout(6400);
  await expect(page.getByTestId('exercise-quick-undo')).toHaveCount(0);
  expect(serverSets(server, 'a')).toEqual(afterQuick);
  expect(await restDeadline(page)).toBe(deadline);

  // Second exercise: complete it, then change one of its sets before Undo.
  await card(page, 'Goblet Squat').getByTestId('exercise-quick-complete').click();
  await settle(page);
  const reps = page.locator('input[aria-label="Goblet Squat set 1 performed reps"]');
  await reps.fill('9');
  await reps.blur();
  await settle(page);
  const writesBefore = results.writes.length;
  const changed = serverSets(server, 'b');
  await page.getByTestId('exercise-quick-undo-button').click();
  await expect(page.getByText('A set changed since; undo it one set at a time.')).toBeVisible();
  await page.waitForTimeout(300);
  expect(results.writes.length).toBe(writesBefore);
  expect(serverSets(server, 'b')).toEqual(changed);
});

test('offline: the completion and the Undo stay queued in order and send in order on reconnect', async ({ page, context }) => {
  const { server, results } = await setup(page);
  await typeReps(page, 2, '4');
  await settle(page);
  const before = serverSets(server, 'a');
  const writesBefore = results.writes.length;
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await card(page, 'Incline Press').getByTestId('exercise-quick-complete').click();
  await page.getByTestId('exercise-quick-undo-button').click();
  const queued = await page.evaluate(() => JSON.parse(localStorage.getItem('cvf_workout_outbox_undo-log') || '[]').map((op) => `${op.setId}:${op.data.status}`));
  expect(queued).toEqual(['a-s2:completed', 'a-s3:completed', 'a-s2:pending', 'a-s3:pending']);
  expect(results.writes.length).toBe(writesBefore);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await settle(page);
  expect(results.writes.slice(writesBefore).map((w) => `${w.setId}:${w.status}`)).toEqual(['a-s2:completed', 'a-s3:completed', 'a-s2:pending', 'a-s3:pending']);
  expect(serverSets(server, 'a')).toEqual(before);
  await expect(page.locator('input[aria-label="Incline Press set 2 performed reps"]')).toHaveValue('4');
  // Once the queued Undo write is acknowledged, the untouched prefill of set 3 is untouched again.
  await expect(card(page, 'Incline Press').getByTestId('exercise-quick-complete')).toHaveText(/Record 2 remaining as entered \(1 with details, 1 without\)/);
});

test('after Undo and a reload, an untouched prefilled set is still untouched: a second quick complete does not record the prescribed weight', async ({ page }) => {
  const { results } = await setup(page);
  const quick = card(page, 'Incline Press').getByTestId('exercise-quick-complete');
  await expect(quick).toHaveText(/Record 2 remaining as entered \(0 with details, 2 without\)/);
  await quick.click();
  await settle(page);
  expect(results.writes.filter((w) => w.status === 'completed').map((w) => w.actual_load_value)).toEqual([null, null]);
  await page.getByTestId('exercise-quick-undo-button').click();
  await settle(page);
  await expect(quick).toHaveText(/Record 2 remaining as entered \(0 with details, 2 without\)/);
  await page.reload();
  await expect(page.getByTestId('workout-outline')).toBeVisible();
  await expect(card(page, 'Incline Press').getByTestId('exercise-quick-complete')).toHaveText(/Record 2 remaining as entered \(0 with details, 2 without\)/);
  const writesBefore = results.writes.length;
  await card(page, 'Incline Press').getByTestId('exercise-quick-complete').click();
  await settle(page);
  expect(results.writes.slice(writesBefore).map((w) => [w.setId, w.status, w.actual_load_value])).toEqual([['a-s2', 'completed', null], ['a-s3', 'completed', null]]);
  // Typing into a set makes its values the person's own again.
  await page.getByTestId('exercise-quick-undo-button').click();
  await settle(page);
  await page.locator('input[aria-label="Incline Press set 3 performed reps"]').fill('7');
  await page.locator('input[aria-label="Incline Press set 3 performed reps"]').blur();
  await settle(page);
  await expect(card(page, 'Incline Press').getByTestId('exercise-quick-complete')).toHaveText(/Record 2 remaining as entered \(1 with details, 1 without\)/);
  expect(results.errors).toEqual([]);
});

test('scrolling right after Undo is never pulled back by the view restore', async ({ page }) => {
  await setup(page);
  await card(page, 'Incline Press').getByTestId('exercise-quick-complete').click();
  await settle(page);
  const box = await region(page).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // Probe the restore: watch every frame for 500 ms after Undo, and scroll
  // with the wheel as soon as the first frame has run.
  await page.evaluate(() => {
    window.__tops = [];
    const node = document.querySelector('[data-testid="workout-scroll-region"]');
    const start = performance.now();
    const tick = () => { window.__tops.push(node.scrollTop); if (performance.now() - start < 500) requestAnimationFrame(tick); };
    document.querySelector('[data-testid="exercise-quick-undo-button"]').addEventListener('click', () => requestAnimationFrame(tick), { once: true });
  });
  await page.getByTestId('exercise-quick-undo-button').click();
  await page.mouse.wheel(0, 240);
  await page.waitForTimeout(600);
  const tops = await page.evaluate(() => window.__tops);
  const peak = Math.max(...tops);
  // Once the person scrolled, later frames never go back up to the restored position.
  const afterPeak = tops.slice(tops.indexOf(peak));
  expect(peak).toBeGreaterThan(tops[0]);
  expect(Math.min(...afterPeak)).toBeGreaterThanOrEqual(peak - 1);
});

// Independent finding 01 (2026-11-12): after Undo, another device (here the
// coach) explicitly saves the prescribed 50 lb with blank reps; this device has
// already fetched that newer revision before quick completing again. The saved
// weight is newer input and must never be stripped.
// Mapped (cross-device Undo release 2026-11-12, coordinator's old-server
// correction): this synthetic API is an OLD server (no value_origin). There a
// load-only value at a newer revision from another device cannot be told apart
// from another device's restored prefill, so quick complete no longer records
// it as 50 (that could invent a weight); it is gated with a reason, the 50 lb is
// kept on the server and on screen, and recording set 3 on its own records 50.
// The original "recorded 50" expectation is kept for the new schema in
// workout-ux-cross-device-undo.spec.mjs (finding 01 on the new schema).
for (const how of ['refresh', 'reload']) {
  test(`a newer saved weight fetched by ${how} after Undo is never stripped: an old server gates the shortcut and set 3 records 50 on its own`, async ({ page }) => {
    const { server, results } = await setup(page);
    const quick = () => card(page, 'Incline Press').getByTestId('exercise-quick-complete');
    await quick().click();
    await settle(page);
    await page.getByTestId('exercise-quick-undo-button').click();
    await settle(page);
    await expect(quick()).toHaveText(/Record 2 remaining as entered \(0 with details, 2 without\)/);
    const s3 = server.exercises[0].sets[2];
    const undoRevision = s3.revision;
    Object.assign(s3, { actual_load_value: 50, actual_load_unit: 'lb', revision: undoRevision + 1, last_actor_role: 'coach' });
    if (how === 'reload') {
      await page.reload();
      await expect(page.getByTestId('workout-outline')).toBeVisible();
    } else {
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
    }
    await expect(quickReason(page)).toHaveText(/^Set 3 may still be the prescribed weight\. Record it on its own or enter what you did\.$/);
    await expect(quick()).toHaveCount(0);
    await expect(page.locator('input[aria-label="Incline Press set 3 weight"]')).toHaveValue('50');
    const writesBefore = results.writes.length;
    await page.locator('[data-set-id="a-s3"] button[aria-label="Complete set 3"]').click();
    await settle(page);
    expect(results.writes.slice(writesBefore).map((w) => [w.setId, w.status, w.actual_load_value])).toEqual([['a-s3', 'completed', 50]]);
    expect(server.exercises[0].sets[2].actual_load_value).toBe(50);
    expect(results.writes.filter((w) => w.setId === 'a-s3' && w.status === 'completed' && w.base_revision > undoRevision).every((w) => w.actual_load_value === 50)).toBe(true);
    expect(results.errors).toEqual([]);
  });
}

// Independent finding 02 (2026-11-12): this device's own Undo write for set 3 is
// committed by the server, but its answer is held. Until that answer arrives
// nobody can tell whether the set holds this device's restored prescription or
// someone else's newer value, so quick complete must neither record the
// prescription as performed nor strip a newer value: it waits, with a reason,
// and lifts by itself when the answer arrives.
const PRESCRIPTION_KEY = `cvf_workout_prefill_${LOG}`;
// Cross-device Undo (2026-11-12): this device now also keeps 'entered' markers
// for its own acknowledged writes (so an old server never gates them). The
// finding 02 checks that no Undo-prefill marker is left behind are kept by
// asserting there is no marker without origin 'entered'.
const prefillMarkersLeft = (page) => page.evaluate((key) => Object.entries(JSON.parse(localStorage.getItem(key) || '{}'))
  .filter(([, marker]) => marker?.origin !== 'entered').map(([setId]) => setId), PRESCRIPTION_KEY);
async function holdUndoAnswer(page, server, setId, { conflictWith = null } = {}) {
  let open;
  const gate = new Promise((resolve) => { open = resolve; });
  const state = { requests: 0, release: () => open() };
  let answer = null;
  await page.route(`**/api/workout-logs/${LOG}/sets/${setId}`, async (route) => {
    const body = route.request().postDataJSON();
    if (body.status !== 'pending') return route.fallback();
    state.requests += 1;
    if (!answer) {
      const set = server.exercises.flatMap((exercise) => exercise.sets).find((item) => item.id === setId);
      if (conflictWith) {
        // Another writer got there first; the server keeps that value.
        Object.assign(set, conflictWith, { revision: set.revision + 1, last_actor_role: 'coach' });
        answer = { row: { ...set }, outcome: 'conflict' };
      } else {
        for (const key of SET_FIELDS) if (key in body) set[key] = body[key];
        Object.assign(set, { revision: set.revision + 1, last_actor_role: 'client' });
        answer = { row: { ...set }, outcome: 'applied' };
      }
    }
    await gate;
    const event = state.requests > 1 ? { outcome: 'replayed', original_outcome: answer.outcome } : { outcome: answer.outcome };
    try {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...answer.row, event }) });
    } catch { /* the page that sent this request has reloaded */ }
  });
  return state;
}
const s3Completions = (results) => results.writes.filter((w) => w.setId === 'a-s3' && w.status === 'completed');

for (const [width, height] of [[390, 844], [320, 700]]) {
  test(`${width}×${height}: an Undo committed but unanswered across a reload never turns the prescription into a performed weight`, async ({ page }) => {
    const { server, results } = await setup(page, { width, height });
    await quickButton(page).click();
    await settle(page);
    const held = await holdUndoAnswer(page, server, 'a-s3');
    await page.getByTestId('exercise-quick-undo-button').click();
    await expect.poll(() => held.requests).toBe(1);
    expect(server.exercises[0].sets[2]).toMatchObject({ status: 'pending', actual_load_value: 50, revision: 2 });
    await page.reload();
    await expect(page.getByTestId('workout-outline')).toBeVisible();
    await expect.poll(() => held.requests).toBeGreaterThan(1);
    // Waiting for the answer: no shortcut, a clear reason, and set 3 still shows the restored 50 lb.
    await expect(quickReason(page)).toHaveText(/^Set 3 is still confirming your Undo\. Record sets one at a time, or wait for it to save\.$/);
    await expect(quickButton(page)).toHaveCount(0);
    await expect(page.locator('input[aria-label="Incline Press set 3 weight"]')).toHaveValue('50');
    await page.screenshot({ path: test.info().outputPath(`gated-pending-answer-${width}x${height}.png`) });
    held.release();
    await settle(page);
    // Mapped (Ultra F2, 2026-11-12): was "the answer says the value is this
    // device's own restored prescription: still untouched", then a quick
    // complete recording [a-s2 null, a-s3 null]. After the reload the answer
    // arrives as a replay, which carries the server's CURRENT row, not proof of
    // what this Undo wrote; on this old-server harness (no value_origin) the
    // load-only set is therefore gated with its 50 lb kept: never recorded as
    // performed and never stripped. The new-schema copy (the server origin
    // still says prefill: untouched, no weight recorded) is in
    // workout-ux-cross-device-undo.spec.mjs.
    await expect(quickReason(page)).toHaveText(/^Set 3 may still be the prescribed weight\. Record it on its own or enter what you did\.$/);
    await expect(quickButton(page)).toHaveCount(0);
    await expect(page.locator('input[aria-label="Incline Press set 3 weight"]')).toHaveValue('50');
    await page.screenshot({ path: test.info().outputPath(`after-answer-${width}x${height}.png`) });
    const start = results.writes.length;
    await page.waitForTimeout(500);
    expect(results.writes.slice(start)).toEqual([]);
    expect(s3Completions(results).every((w) => w.actual_load_value === null)).toBe(true);
    // Mapped (cross-device Undo): was `localStorage.getItem(PRESCRIPTION_KEY) === null`.
    // Mapped again (Ultra F2): was `[]` after set 2 was recorded. Set 2 is not
    // recorded now (the shortcut is gated), so its own freshly applied Undo
    // marker legitimately remains; set 3's marker was retired by the replay.
    expect(await prefillMarkersLeft(page)).toEqual(['a-s2']);
    expect(results.errors).toEqual([]);
  });
}

test('the same race through an in-page refresh: the shortcut waits past the six-second window, then lifts on the answer', async ({ page }) => {
  const { server, results } = await setup(page);
  await quickButton(page).click();
  await settle(page);
  const held = await holdUndoAnswer(page, server, 'a-s3');
  await page.getByTestId('exercise-quick-undo-button').click();
  await expect.poll(() => held.requests).toBe(1);
  // Not yet known to be applied: still the untouched prefill on this device.
  await expect(quickButton(page)).toHaveText(/Record 2 remaining as entered \(0 with details, 2 without\)/);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(quickReason(page)).toHaveText(/^Set 3 is still confirming your Undo\./);
  await page.waitForTimeout(6500);
  await expect(page.getByTestId('exercise-quick-undo-button')).toHaveCount(0);
  await expect(quickReason(page)).toHaveText(/^Set 3 is still confirming your Undo\./);
  await expect(quickButton(page)).toHaveCount(0);
  held.release();
  await settle(page);
  await expect(quickButton(page)).toHaveText(/Record 2 remaining as entered \(0 with details, 2 without\)/);
  const start = results.writes.length;
  await quickButton(page).click();
  await settle(page);
  expect(results.writes.slice(start).map((w) => [w.setId, w.status, w.actual_load_value])).toEqual([['a-s2', 'completed', null], ['a-s3', 'completed', null]]);
  expect(held.requests).toBe(1);
  expect(results.errors).toEqual([]);
});

test('an unanswered Undo that turns out to have lost to another writer keeps that newer value: never stripped, never invented', async ({ page }) => {
  const { server, results } = await setup(page);
  await quickButton(page).click();
  await settle(page);
  const held = await holdUndoAnswer(page, server, 'a-s3', { conflictWith: { status: 'pending', actual_load_value: 55, actual_load_unit: 'lb', actual_reps: null } });
  await page.getByTestId('exercise-quick-undo-button').click();
  await expect.poll(() => held.requests).toBe(1);
  await page.reload();
  await expect(page.getByTestId('workout-outline')).toBeVisible();
  await expect.poll(() => held.requests).toBeGreaterThan(1);
  await expect(quickReason(page)).toHaveText(/^Set 3 is still confirming your Undo\./);
  await expect(quickButton(page)).toHaveCount(0);
  held.release();
  await settle(page);
  // The answer: the server kept the coach's 55 lb. It is newer input and is kept.
  // Mapped (cross-device Undo release, old-server correction): this OLD server
  // gives no origin, so a load-only value from another writer is gated, not
  // recorded by the shortcut; recording set 3 on its own records 55. The
  // new-schema copy (cross-device spec) keeps "quick complete records 55".
  await expect(page.locator('input[aria-label="Incline Press set 3 weight"]')).toHaveValue('55');
  await expect(quickReason(page)).toHaveText(/^Set 3 may still be the prescribed weight\./);
  await expect(quickButton(page)).toHaveCount(0);
  const start = results.writes.length;
  await page.locator('[data-set-id="a-s3"] button[aria-label="Complete set 3"]').click();
  await settle(page);
  expect(results.writes.slice(start).map((w) => [w.setId, w.status, w.actual_load_value])).toEqual([['a-s3', 'completed', 55]]);
  expect(server.exercises[0].sets[2].actual_load_value).toBe(55);
  expect(s3Completions(results).every((w) => w.actual_load_value === null || w.actual_load_value === 55)).toBe(true);
  // Set 2 still holds this device's acknowledged restored prefill: the shortcut
  // records it without a weight, which also retires its marker.
  await expect(quickButton(page)).toHaveText(/Record 1 remaining as entered \(0 with details, 1 without\)/);
  const second = results.writes.length;
  await quickButton(page).click();
  await settle(page);
  expect(results.writes.slice(second).map((w) => [w.setId, w.status, w.actual_load_value])).toEqual([['a-s2', 'completed', null]]);
  // Mapped: was `localStorage.getItem(PRESCRIPTION_KEY) === null`.
  expect(await prefillMarkersLeft(page)).toEqual([]);
  expect(results.errors).toEqual([]);
});

test('an Undo write the server rejects leaves no marker behind: nothing waits on an answer that already came', async ({ page }) => {
  const { server, results } = await setup(page);
  await quickButton(page).click();
  await settle(page);
  await page.route(`**/api/workout-logs/${LOG}/sets/a-s3`, (route) => (route.request().postDataJSON().status === 'pending'
    ? route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'Synthetic rejection' }) })
    : route.fallback()));
  await page.getByTestId('exercise-quick-undo-button').click();
  await settle(page);
  const marks = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), PRESCRIPTION_KEY);
  expect(Object.keys(marks)).not.toContain('a-s3');
  // The rejected set is still completed on the server and on screen; nothing is gated.
  expect(server.exercises[0].sets[2].status).toBe('completed');
  await page.reload();
  await expect(page.getByTestId('workout-outline')).toBeVisible();
  await expect(quickReason(page)).toHaveCount(0);
  await expect(quickButton(page)).toHaveText(/Record 1 remaining as entered \(0 with details, 1 without\)/);
  expect(results.errors).toEqual([]);
});

test('an Undo marker left without its operation waits with a recovery reason; recording that set yourself lifts it', async ({ page }) => {
  const { server, results } = await setup(page);
  // Set 3 holds the restored prescription at a revision this device cannot account for.
  Object.assign(server.exercises[0].sets[2], { status: 'pending', actual_load_value: 50, actual_load_unit: 'lb', revision: 2, last_actor_role: 'client' });
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ 'a-s3': { op: 'synthetic-gone-op', base: 1 } })), PRESCRIPTION_KEY);
  await page.reload();
  await expect(page.getByTestId('workout-outline')).toBeVisible();
  await expect(quickReason(page)).toHaveText(/^Set 3's earlier Undo could not be confirmed\. Check its values and record it on its own\.$/);
  await expect(quickButton(page)).toHaveCount(0);
  expect(results.writes).toEqual([]);
  await typeReps(page, 3, '7');
  await settle(page);
  await expect(quickReason(page)).toHaveCount(0);
  await expect(quickButton(page)).toHaveText(/Record 2 remaining as entered \(1 with details, 1 without\)/);
  const start = results.writes.length;
  await quickButton(page).click();
  await settle(page);
  expect(results.writes.slice(start).map((w) => [w.setId, w.status, w.actual_load_value, w.actual_reps])).toEqual([['a-s2', 'completed', null, null], ['a-s3', 'completed', 50, 7]]);
  expect(results.errors).toEqual([]);
});
