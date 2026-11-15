// Look A per-exercise Done and the one Undo (adapted 2026-11-15 from the
// 2026-11-12 bulk "Record N remaining as entered" + six-second Undo contract;
// LOOK-A-BROWSER-CONTRACT-MAP, LOOK-A-TEST-ADAPTATION-ADDENDUM).
//
// Done now sets one "done, not set-tracked" flag and leaves every set row
// untouched; the Undo in the dock is one revision-checked server inverse that
// stays until the next material change. The old protections against an Undo
// write turning a prescription into a performed value are kept, seeded as
// legacy queued writes and markers (flag-only Done no longer produces them).
// Normal mode, stateful synthetic API (look-a-server.mjs), fictional data only.
import { test, expect } from '@playwright/test';
import { makeServer, installServer, clone, held, sent, card, reps, settled, undoButton, open } from './look-a-server.mjs';

const LOG = 'undo-log';
const REST_KEY = `cvf_rest_timer_${LOG}`;
const OUTBOX = `cvf_workout_outbox_${LOG}`;
const PRESCRIPTION_KEY = `cvf_workout_prefill_${LOG}`;
const row = (exercise, n, extra = {}) => ({
  id: `${exercise}-s${n}`, workout_log_exercise_id: exercise, set_number: n, status: 'pending', set_origin: 'prescribed',
  actual_load_value: 50, actual_load_unit: 'lb', actual_reps: null, actual_rpe: null,
  actual_duration_value: null, actual_duration_unit: null, actual_distance_value: null, actual_distance_unit: null,
  revision: 0, last_actor_role: null, value_origin: 'prefill', value_origin_nonce: null, archived: false,
  updated_at: '2026-11-14T11:00:00.000Z', ...extra,
});
const exercise = (id, name, load, sets, extra = {}) => ({
  id, exercise_name: name, tracking_type: 'reps_weight', prescribed_sets: String(sets.length), prescribed_reps: '8', prescribed_load_value: load, prescribed_load_unit: 'lb',
  prescribed_rest_seconds: 60, superset_group: null, plan_revision: 0, backups: [], not_set_tracked: false, sets, ...extra,
});
// A mixed exercise: a completed set, a set typed into (saved), an untouched prefilled set and a skipped set.
const fixtureLog = () => ({
  id: LOG, client_id: 'undo-client', workout_name: 'Fictional undo workout', status: 'active', started_at: new Date().toISOString(), not_set_tracked: false,
  exercises: [
    exercise('a', 'Incline Press', 50, [
      row('a', 1, { status: 'completed', actual_reps: 8, revision: 2, last_actor_role: 'client', value_origin: 'entered', value_origin_nonce: 'seed-a1' }),
      row('a', 2, { actual_reps: 4, revision: 1, last_actor_role: 'client', value_origin: 'entered', value_origin_nonce: 'seed-a2' }),
      row('a', 3),
      row('a', 4, { status: 'skipped', actual_load_value: null, actual_load_unit: null, revision: 1, last_actor_role: 'client', value_origin: 'entered' }),
    ]),
    exercise('b', 'Goblet Squat', 35, [1, 2, 3].map((n) => row('b', n, { actual_load_value: 35 }))),
    exercise('c', 'Cable Row', 40, [1, 2, 3].map((n) => row('c', n, { actual_load_value: 40 }))),
  ],
  coach_responses: [], conflicts: [], substitutions: [],
});

async function setup(page, { width = 390, height = 844, seed = null, legacySetReplies = false, oldServer = false, alerts = false } = {}) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((on) => {
    if (on) localStorage.setItem('cvf_rest_alerts', 'on');
    window.__vibrations = 0;
    navigator.vibrate = () => { window.__vibrations += 1; return true; };
  }, alerts);
  const server = makeServer(fixtureLog());
  if (seed) seed(server);
  const results = await installServer(page, server, { logId: LOG, legacySetReplies: legacySetReplies || oldServer, oldServer });
  await open(page, LOG);
  return { server, results };
}
// Complete server rows: every field, revisions, actor, provenance and timestamps included.
const rows = (server, exerciseId) => clone(server.log.exercises.find((e) => e.id === exerciseId).sets);
const flag = (server, exerciseId) => server.log.exercises.find((e) => e.id === exerciseId).not_set_tracked;
const setWrites = (server) => sent(server, /\/sets\//);
const undos = (server) => sent(server, /\/undo$/);
const done = (page, name) => card(page, name).getByTestId('exercise-quick-complete');
const restDeadline = (page) => page.evaluate((key) => localStorage.getItem(key), REST_KEY);
const region = (page) => page.getByTestId('workout-scroll-region');
const queuedUrls = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]').map((op) => op.url.split('/').slice(-2).join('/')), OUTBOX);
const markers = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), PRESCRIPTION_KEY);
// Nothing to undo: no enabled Undo exists (Look A round 1: the slot is absent
// until the first change, then stays disabled "Nothing to undo").
const noUndo = async (page) => {
  await expect(page.locator('[data-testid="workout-undo-button"]:not([disabled])')).toHaveCount(0);
};

for (const [width, height] of [[390, 844], [320, 700]]) {
  test(`${width}×${height}: Done sets only the flag and Undo clears only the flag; every set row is identical throughout`, async ({ page }) => {
    const { server, results } = await setup(page, { width, height });
    const before = rows(server, 'a');
    await page.getByTestId('rest-start').click();
    const deadline = await restDeadline(page);
    await done(page, 'Incline Press').scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    const windowBefore = await page.evaluate(() => window.scrollY);
    await page.screenshot({ path: test.info().outputPath(`1-before-${width}x${height}.png`) });

    await done(page, 'Incline Press').click();
    await settled(page, LOG);
    expect(flag(server, 'a')).toBe(true);
    expect(rows(server, 'a')).toEqual(before);
    await expect(undoButton(page)).toHaveAccessibleName(/Undo Incline Press done/);
    await page.screenshot({ path: test.info().outputPath(`2-after-done-${width}x${height}.png`) });

    await undoButton(page).click();
    await settled(page, LOG);
    expect(flag(server, 'a')).toBe(false);
    expect(rows(server, 'a')).toEqual(before);
    // No set was written by Done or by its Undo; one Done, one Undo, aimed at it.
    expect(setWrites(server)).toEqual([]);
    expect(sent(server, /\/exercises\/a\/done$/)).toHaveLength(1);
    expect(undos(server).map((r) => r.body.change_id)).toEqual([sent(server, /\/done$/)[0].body.event_id]);
    // The page shows the same values: typed reps, the untouched prefill, the completed and skipped sets.
    await expect(reps(page, 'Incline Press', 2)).toHaveValue('4');
    await expect(page.locator('input[aria-label="Incline Press set 3 weight"]')).toHaveValue('50');
    await expect(reps(page, 'Incline Press', 3)).toHaveValue('');
    await expect(page.locator('[data-set-id="a-s1"] button[aria-label="Mark incomplete set 1"]')).toBeVisible();
    await expect(done(page, 'Incline Press')).toBeVisible();
    // Done never touched the rest timer the person started.
    expect(await restDeadline(page)).toBe(deadline);
    // Done moved the view on to the next exercise; its Undo brings Incline Press back into view.
    await expect(card(page, 'Incline Press')).toBeInViewport();
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - windowBefore)).toBeLessThanOrEqual(1);
    await noUndo(page);
    await page.screenshot({ path: test.info().outputPath(`3-after-undo-${width}x${height}.png`) });
    expect(results.unexpected).toEqual([]);
    expect(results.errors).toEqual([]);
  });
}

test('the Undo stays past six seconds and across a reload until it is used', async ({ page }) => {
  const { server, results } = await setup(page);
  await done(page, 'Incline Press').click();
  await settled(page, LOG);
  await page.waitForTimeout(6500);
  await expect(undoButton(page)).toHaveAccessibleName(/Undo Incline Press done/);
  await page.reload();
  await expect(page.getByTestId('workout-outline')).toBeVisible();
  await expect(undoButton(page)).toHaveAccessibleName(/Undo Incline Press done/);
  await undoButton(page).click();
  await settled(page, LOG);
  expect(flag(server, 'a')).toBe(false);
  await noUndo(page);
  expect(results.errors).toEqual([]);
});

test('a newer successful set edit becomes the Undo; using it leaves Done in place and offers no older Undo, before or after a reload', async ({ page }) => {
  const { server, results } = await setup(page);
  await done(page, 'Incline Press').click();
  await settled(page, LOG);
  const goblet = rows(server, 'b');
  await reps(page, 'Goblet Squat', 1).fill('9');
  await reps(page, 'Goblet Squat', 1).blur();
  await settled(page, LOG);
  await expect(undoButton(page)).toHaveAccessibleName(/Undo set 1 of Goblet Squat/);
  await undoButton(page).click();
  await settled(page, LOG);
  // Only the set edit is undone; its row is back to its values; Done stays.
  const after = rows(server, 'b');
  expect(after.map(({ status, actual_reps: r, actual_load_value: l, value_origin: o }) => [status, r, l, o]))
    .toEqual(goblet.map(({ status, actual_reps: r, actual_load_value: l, value_origin: o }) => [status, r, l, o]));
  expect(flag(server, 'a')).toBe(true);
  expect(undos(server).map((r) => r.body.change_id)).toEqual([setWrites(server)[0].body.event_id]);
  await noUndo(page);
  await page.reload();
  await expect(page.getByTestId('workout-outline')).toBeVisible();
  await noUndo(page);
  expect(results.errors).toEqual([]);
});

test('a refused set write keeps the earlier Undo, which still works', async ({ page }) => {
  const { server, results } = await setup(page);
  await done(page, 'Incline Press').click();
  await settled(page, LOG);
  server.reject.set('b-s1', 'Synthetic rejection');
  await reps(page, 'Goblet Squat', 1).fill('9');
  await reps(page, 'Goblet Squat', 1).blur();
  await expect.poll(() => setWrites(server).length).toBeGreaterThan(0);
  await settled(page, LOG);
  await expect(undoButton(page)).toHaveAccessibleName(/Undo Incline Press done/);
  await undoButton(page).click();
  await settled(page, LOG);
  expect(flag(server, 'a')).toBe(false);
  expect([...server.changes.values()].filter((c) => c.kind === 'undo' && c.outcome === 'applied')).toHaveLength(1);
  expect(results.errors).toEqual([]);
});

test('a coach prescription change ends the Undo: a stale tap is refused and changes nothing; the offer goes away', async ({ page }) => {
  const { server, results } = await setup(page);
  await done(page, 'Incline Press').click();
  await settled(page, LOG);
  await expect(undoButton(page)).toHaveAccessibleName(/Undo Incline Press done/);
  const before = rows(server, 'a');
  server.coachPrescription('a', { prescribed_load_value: 55 });
  // This page still offers its older Undo; the server refuses it.
  await undoButton(page).click();
  await settled(page, LOG);
  expect(flag(server, 'a')).toBe(true);
  expect(rows(server, 'a')).toEqual(before);
  expect([...server.changes.values()].filter((c) => c.kind === 'undo').map((c) => c.outcome)).toEqual(['refused']);
  await noUndo(page);
  await page.reload();
  await expect(page.getByTestId('workout-outline')).toBeVisible();
  await noUndo(page);
  expect(setWrites(server)).toEqual([]);
  expect(results.errors).toEqual([]);
});

test('a double tap on Undo sends one Undo', async ({ page }) => {
  const { server, results } = await setup(page);
  await done(page, 'Incline Press').click();
  await settled(page, LOG);
  await undoButton(page).dblclick();
  await settled(page, LOG);
  await page.waitForTimeout(300);
  expect(new Set(undos(server).map((r) => r.body.event_id)).size).toBe(1);
  expect(flag(server, 'a')).toBe(false);
  expect(results.errors).toEqual([]);
});

// Offline here is this tab's navigator.onLine plus an unreachable server
// (context.setOffline also blocks the dev server's lazily loaded modules).
test('offline: Done and its Undo stay queued in order and send in order on reconnect; no set is written', async ({ page }) => {
  await page.addInitScript(() => {
    window.__online = true;
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => window.__online });
  });
  const { server, results } = await setup(page);
  const before = rows(server, 'a');
  server.down = true;
  await page.evaluate(() => { window.__online = false; window.dispatchEvent(new Event('offline')); });
  await done(page, 'Incline Press').click();
  await undoButton(page).click();
  expect(await queuedUrls(page)).toEqual(['a/done', `${LOG}/undo`]);
  expect(server.requests).toEqual([]);
  server.down = false;
  await page.evaluate(() => { window.__online = true; window.dispatchEvent(new Event('online')); });
  await settled(page, LOG);
  expect(server.requests.map((r) => r.path.split('/').slice(-2).join('/'))).toEqual(['a/done', `${LOG}/undo`]);
  expect(flag(server, 'a')).toBe(false);
  expect(rows(server, 'a')).toEqual(before);
  await expect(reps(page, 'Incline Press', 2)).toHaveValue('4');
  expect(results.errors).toEqual([]);
});

test('after Done, Undo and a reload the prefilled set is still untouched: a second Done records no weight', async ({ page }) => {
  const { server, results } = await setup(page);
  await done(page, 'Incline Press').click();
  await settled(page, LOG);
  await undoButton(page).click();
  await settled(page, LOG);
  await page.reload();
  await expect(page.getByTestId('workout-outline')).toBeVisible();
  const before = rows(server, 'a');
  await done(page, 'Incline Press').click();
  await settled(page, LOG);
  expect(rows(server, 'a')).toEqual(before);
  expect(rows(server, 'a')[2]).toMatchObject({ status: 'pending', actual_reps: null, value_origin: 'prefill' });
  expect(setWrites(server)).toEqual([]);
  expect(results.errors).toEqual([]);
});

// ---------- Legacy protections, seeded (the old bulk Undo wrote set rows) ----------
// A queued set write from the old six-second Undo (status back to pending with
// the prescription restored) and this device's marker for it.
const legacyUndoWrite = (setId, id = 'legacy-undo-op') => ({
  id, attempts: 0, kind: 'set', exerciseId: 'a', setId, method: 'patch', url: `/workout-logs/${LOG}/sets/${setId}`,
  // Queued by the 2026-11-12 build: the pt-session-events/v1 envelope (event id = queue id) was added at enqueue.
  data: { status: 'pending', actual_load_value: 50, actual_load_unit: 'lb', actual_reps: null, actual_rpe: null, event_id: id, base_revision: 1, local_seq: 1, offline: false, plan_revision_seen: 0 },
});
async function seedLegacy(page, queue, marks) {
  await page.evaluate(([outbox, prefill, q, m]) => {
    if (q) localStorage.setItem(outbox, JSON.stringify(q));
    if (m) localStorage.setItem(prefill, JSON.stringify(m));
  }, [OUTBOX, PRESCRIPTION_KEY, queue, marks]);
  await page.reload();
  await expect(page.getByTestId('workout-outline')).toBeVisible();
}

test('legacy: an old Undo write the server rejects leaves no marker behind and nothing waits on it', async ({ page }) => {
  const { server, results } = await setup(page, { seed: (s) => Object.assign(s.find('a-s3'), { status: 'completed', actual_load_value: null, actual_load_unit: null, revision: 1, last_actor_role: 'client', value_origin: 'entered' }) });
  server.reject.set('a-s3', 'Synthetic rejection');
  await seedLegacy(page, [legacyUndoWrite('a-s3')], { 'a-s3': { op: 'legacy-undo-op', base: 1 } });
  await expect.poll(() => setWrites(server).length).toBe(1);
  await settled(page, LOG);
  expect(Object.keys(await markers(page))).not.toContain('a-s3');
  expect(server.find('a-s3').status).toBe('completed');
  await page.reload();
  await expect(page.getByTestId('workout-outline')).toBeVisible();
  // The set is an ordinary completed set again: it can be changed directly.
  await expect(page.locator('[data-set-id="a-s3"] button[aria-label="Mark incomplete set 3"]')).toBeEnabled();
  expect(undos(server)).toEqual([]);
  expect(results.errors).toEqual([]);
});

test('legacy: a marker left without its write is never treated as untouched; typing into that set lifts it', async ({ page }) => {
  const { server, results } = await setup(page, { seed: (s) => Object.assign(s.find('a-s3'), { revision: 2, last_actor_role: 'client', value_origin: 'legacy' }) });
  await seedLegacy(page, null, { 'a-s3': { op: 'synthetic-gone-op', base: 1 } });
  expect(server.requests).toEqual([]);
  // Today's plan from set 2 never targets set 3 while its old Undo is unaccounted for.
  await card(page, 'Incline Press').getByRole('button', { name: 'Complete set 2', exact: true }).click();
  await settled(page, LOG);
  await card(page, 'Incline Press').getByTestId('plan-keep').click();
  await expect(card(page, 'Incline Press').getByTestId('plan-log')).toHaveCount(0);
  // Typing makes set 3's values the person's own.
  await reps(page, 'Incline Press', 3).fill('7');
  await reps(page, 'Incline Press', 3).blur();
  await settled(page, LOG);
  // Its own acknowledged write leaves at most an 'entered' marker, never the old Undo one.
  expect((await markers(page))['a-s3']?.op).not.toBe('synthetic-gone-op');
  expect(['entered', undefined]).toContain((await markers(page))['a-s3']?.origin);
  expect(setWrites(server).filter((r) => r.path.endsWith('/a-s3')).map((r) => [r.body.actual_load_value, r.body.actual_reps])).toEqual([[50, 7]]);
  expect(results.errors).toEqual([]);
});

test('legacy: an old Undo write committed but unanswered across a reload replays once and never turns the prescription into a performed weight', async ({ page }) => {
  const { server, results } = await setup(page, { seed: (s) => Object.assign(s.find('a-s3'), { status: 'completed', actual_load_value: null, actual_load_unit: null, revision: 1, last_actor_role: 'client', value_origin: 'entered' }) });
  server.drop.add('sets/a-s3');
  await seedLegacy(page, [legacyUndoWrite('a-s3')], { 'a-s3': { op: 'legacy-undo-op', base: 1 } });
  await expect.poll(() => setWrites(server).length).toBeGreaterThan(0);
  expect(server.find('a-s3')).toMatchObject({ status: 'pending', actual_load_value: 50, revision: 2 });
  server.drop.delete('sets/a-s3');
  await page.reload();
  await expect(page.getByTestId('workout-outline')).toBeVisible();
  await settled(page, LOG);
  // The same event replays; it is applied once.
  const ids = new Set(setWrites(server).map((r) => r.body.event_id));
  expect(ids.size).toBe(1);
  expect([...server.changes.values()].filter((c) => c.kind === 'set' && c.outcome === 'applied')).toHaveLength(1);
  // Set 3 shows the restored 50 lb, pending, and no performed weight was recorded by anything.
  await expect(page.locator('input[aria-label="Incline Press set 3 weight"]')).toHaveValue('50');
  expect(server.find('a-s3')).toMatchObject({ status: 'pending', actual_reps: null });
  const start = server.requests.length;
  await done(page, 'Incline Press').click();
  await settled(page, LOG);
  expect(server.requests.slice(start).map((r) => r.path.split('/').slice(-2).join('/'))).toEqual(['a/done']);
  expect(server.find('a-s3')).toMatchObject({ status: 'pending', actual_reps: null });
  expect(undos(server)).toEqual([]);
  expect(results.errors).toEqual([]);
});

test('scrolling right after Undo is never pulled back', async ({ page }) => {
  await setup(page);
  await done(page, 'Incline Press').click();
  await settled(page, LOG);
  await region(page).evaluate((node) => { node.scrollTop = 0; });
  const box = await region(page).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(() => {
    window.__tops = [];
    const node = document.querySelector('[data-testid="workout-scroll-region"]');
    const start = performance.now();
    const tick = () => { window.__tops.push(node.scrollTop); if (performance.now() - start < 500) requestAnimationFrame(tick); };
    document.querySelector('[data-testid="workout-undo-button"]').addEventListener('click', () => requestAnimationFrame(tick), { once: true });
  });
  await undoButton(page).click();
  // The wheel scrolls the workout content, so it starts over the content (the
  // click left the pointer on the dock, which does not scroll the entries).
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 240);
  await page.waitForTimeout(600);
  const tops = await page.evaluate(() => window.__tops);
  const peak = Math.max(...tops);
  expect(peak).toBeGreaterThan(tops[0]);
  expect(Math.min(...tops.slice(tops.indexOf(peak)))).toBeGreaterThanOrEqual(peak - 1);
});

test('a held Undo reply: the button stays unavailable until it answers, then nothing older is offered', async ({ page }) => {
  const { server, results } = await setup(page);
  await done(page, 'Incline Press').click();
  await settled(page, LOG);
  const release = held(server, 'undo');
  await undoButton(page).click();
  await expect.poll(() => undos(server).length).toBe(1);
  await expect(undoButton(page)).toBeDisabled();
  release();
  await settled(page, LOG);
  expect(flag(server, 'a')).toBe(false);
  await noUndo(page);
  expect(undos(server)).toHaveLength(1);
  expect(results.errors).toEqual([]);
});

// ---------- Rest intent, finished-rest alert, keyboard focus (flag-only) ----------
test('a newer rest timer started after Done is kept by its Undo', async ({ page }) => {
  await setup(page);
  await page.getByTestId('rest-start').click();
  await done(page, 'Incline Press').click();
  await settled(page, LOG);
  // The person stops that timer and starts a new one: newer input.
  await page.getByTestId('rest-timer').click();
  await page.getByTestId('rest-start').click();
  const newer = await restDeadline(page);
  await undoButton(page).click();
  await settled(page, LOG);
  expect(await restDeadline(page)).toBe(newer);
  await expect(page.getByTestId('rest-timer')).toHaveAttribute('data-rest-state', 'running');
});

test('a rest timer that already finished stays finished through Done and Undo, without alerting again', async ({ page }) => {
  await setup(page, { alerts: true });
  await page.getByTestId('rest-start').click();
  for (let i = 0; i < 12 && (await page.getByTestId('rest-minus').count()); i += 1) await page.getByTestId('rest-minus').click();
  await expect(page.getByTestId('rest-timer')).toHaveAttribute('data-rest-state', 'complete');
  await expect.poll(() => page.evaluate(() => window.__vibrations)).toBe(1);
  const finished = await restDeadline(page);
  // Count announcements from here on (the live region keeps the earlier "Rest complete").
  await page.evaluate(() => {
    window.__announced = 0;
    const node = document.querySelector('[data-testid="rest-complete-announcement"]');
    new MutationObserver(() => { window.__announced += 1; }).observe(node, { childList: true, characterData: true, subtree: true });
  });
  await done(page, 'Incline Press').click();
  await settled(page, LOG);
  await undoButton(page).click();
  await settled(page, LOG);
  await expect(page.getByTestId('rest-timer')).toHaveAttribute('data-rest-state', 'complete');
  expect(await restDeadline(page)).toBe(finished);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.__vibrations)).toBe(1);
  expect(await page.evaluate(() => window.__announced)).toBe(0);
});

test('keyboard: Done and Undo by Enter; after Undo focus is back on that exercise\'s Done, which still works', async ({ page }) => {
  const { server, results } = await setup(page);
  await done(page, 'Incline Press').focus();
  await page.keyboard.press('Enter');
  await settled(page, LOG);
  await undoButton(page).focus();
  await page.keyboard.press('Enter');
  await settled(page, LOG);
  await expect(done(page, 'Incline Press')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => flag(server, 'a')).toBe(true);
  expect(results.errors).toEqual([]);
});

test('a set write that reaches the server and changes nothing keeps the Undo of Done, which then works', async ({ page }) => {
  const { server, results } = await setup(page);
  await done(page, 'Goblet Squat').click();
  await settled(page, LOG);
  // A queued write equal to set 2's saved row (4 reps, 50 lb), as a page queues it.
  const same = { id: 'noop-op', attempts: 0, kind: 'set', exerciseId: 'a', setId: 'a-s2', method: 'patch', url: `/workout-logs/${LOG}/sets/a-s2`,
    data: { status: 'pending', actual_load_value: 50, actual_load_unit: 'lb', actual_reps: 4, actual_rpe: null, event_id: 'noop-op', base_revision: 1, local_seq: 9, offline: false, plan_revision_seen: 0, value_origin: 'entered' } };
  await page.evaluate(([key, op]) => localStorage.setItem(key, JSON.stringify([op])), [OUTBOX, same]);
  await page.reload();
  await expect(page.getByTestId('workout-outline')).toBeVisible();
  await expect.poll(() => setWrites(server).map((r) => r.body.event_id)).toEqual(['noop-op']);
  await settled(page, LOG);
  // The server recorded nothing material: no inverse, no new current change.
  expect(server.changes.get('noop-op')).toMatchObject({ inverse: null });
  expect(server.current()?.kind).toBe('exercise_done');
  await expect(undoButton(page)).toHaveAccessibleName(/Undo Goblet Squat done/);
  await undoButton(page).click();
  await expect.poll(() => flag(server, 'b')).toBe(false);
  expect(undos(server).map((r) => r.body.change_id)).toEqual([sent(server, /\/exercises\/b\/done$/)[0].body.event_id]);
  expect(results.errors).toEqual([]);
});

test('typing a value and back before leaving the field sends nothing and keeps the Undo of Done', async ({ page }) => {
  const { server, results } = await setup(page);
  await done(page, 'Goblet Squat').click();
  await settled(page, LOG);
  await reps(page, 'Incline Press', 2).fill('5');
  await reps(page, 'Incline Press', 2).fill('4');
  await reps(page, 'Incline Press', 2).blur();
  await page.waitForTimeout(400);
  await expect(undoButton(page)).toHaveAccessibleName(/Undo Goblet Squat done/);
  expect([...server.changes.values()].filter((c) => c.kind === 'set' && c.inverse)).toEqual([]);
  expect(results.errors).toEqual([]);
});

// ---------- Legacy held PATCH races on rows WITHOUT provenance (old server columns) ----------
// What the old bulk quick complete and its six-second Undo left behind: sets 2
// and 3 completed without a weight, then two queued Undo writes putting the
// prescribed 50 lb back, with this device's markers. The server rows carry no
// value_origin at all. The page must never record the prescription as
// performed on its own, never strip a newer value, and recover only through an
// explicit action by the person. (Done itself is not blocked by any of this.)
const afterOldQuick = (s) => {
  for (const id of ['a-s2', 'a-s3']) Object.assign(s.find(id), { status: 'completed', actual_load_value: null, actual_load_unit: null, actual_reps: null, revision: 1, last_actor_role: 'client', value_origin: 'unknown' });
};
const legacyBoth = () => [legacyUndoWrite('a-s2', 'legacy-undo-s2'), legacyUndoWrite('a-s3', 'legacy-undo-s3')];
const legacyMarks = { 'a-s2': { op: 'legacy-undo-s2', base: 1 }, 'a-s3': { op: 'legacy-undo-s3', base: 1 } };
const s3Writes = (server) => setWrites(server).filter((r) => r.path.endsWith('/a-s3'));
// Today's plan from completed set 1 (8 × 50 lb): which sets would it log?
async function planTargetsShown(page) {
  const keep = card(page, 'Incline Press').getByTestId('plan-keep');
  if (await keep.count()) await keep.click();
  const log = card(page, 'Incline Press').getByTestId('plan-log');
  return (await log.count()) ? log.getAttribute('aria-label') : null;
}

for (const [how, width, height] of [['reload', 390, 844], ['reload', 320, 700], ['refresh', 390, 844]]) {
  test(`${width}×${height} legacy (no provenance, ${how}): an old Undo write committed with its reply held is replayed once; set 3 is never recorded by itself and keeps 50 lb until the person records it`, async ({ page }) => {
    const { server, results } = await setup(page, { width, height, oldServer: true, seed: afterOldQuick });
    const release = held(server, 'sets/a-s3');
    await seedLegacy(page, legacyBoth(), legacyMarks);
    await expect.poll(() => s3Writes(server).length).toBeGreaterThan(0);
    expect(server.find('a-s3')).toMatchObject({ status: 'pending', actual_load_value: 50, revision: 2 });
    expect(server.find('a-s3')).not.toHaveProperty('value_origin', 'prefill');
    if (how === 'reload') {
      await page.reload();
      await expect(page.getByTestId('workout-outline')).toBeVisible();
      await expect.poll(() => s3Writes(server).length).toBeGreaterThan(1);
    } else {
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
    }
    await expect(page.locator('input[aria-label="Incline Press set 3 weight"]')).toHaveValue('50');
    release();
    await settled(page, LOG);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForTimeout(500);
    // Applied once; every later write for set 3 is the same event.
    expect(new Set(s3Writes(server).map((r) => r.body.event_id))).toEqual(new Set(['legacy-undo-s3']));
    // Today's plan never targets set 3 (its 50 lb cannot be told from a newer entry).
    const target = await planTargetsShown(page);
    expect(target ?? '').not.toMatch(/set 3/);
    expect(s3Writes(server).filter((r) => r.body.status === 'completed')).toEqual([]);
    // Explicit recovery: the person completes set 3 and its shown 50 lb is recorded.
    await card(page, 'Incline Press').getByRole('button', { name: 'Complete set 3', exact: true }).click();
    await settled(page, LOG);
    expect(s3Writes(server).filter((r) => r.body.status === 'completed').map((r) => r.body.actual_load_value)).toEqual([50]);
    expect(undos(server)).toEqual([]);
    expect(results.errors).toEqual([]);
  });
}

test('legacy (no provenance): an old Undo write that loses to the coach\'s 55 lb, reply held across a reload, keeps 55: never stripped, never invented', async ({ page }) => {
  const { server, results } = await setup(page, { oldServer: true, seed: afterOldQuick });
  server.setHook = (set, body) => {
    if (set.id !== 'a-s3' || body.status !== 'pending') return null;
    Object.assign(set, { status: 'pending', actual_load_value: 55, actual_load_unit: 'lb', actual_reps: null, revision: set.revision + 1, last_actor_role: 'coach', value_origin: 'entered' });
    return { outcome: 'conflict', conflict_id: 'qu-conflict' };
  };
  const release = held(server, 'sets/a-s3');
  await seedLegacy(page, legacyBoth(), legacyMarks);
  await expect.poll(() => s3Writes(server).length).toBeGreaterThan(0);
  server.setHook = null;
  await page.reload();
  await expect(page.getByTestId('workout-outline')).toBeVisible();
  release();
  await settled(page, LOG);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('input[aria-label="Incline Press set 3 weight"]')).toHaveValue('55');
  const target = await planTargetsShown(page);
  expect(target ?? '').not.toMatch(/set 3/);
  expect(server.find('a-s3')).toMatchObject({ actual_load_value: 55, status: 'pending' });
  await card(page, 'Incline Press').getByRole('button', { name: 'Complete set 3', exact: true }).click();
  await settled(page, LOG);
  expect(s3Writes(server).filter((r) => r.body.status === 'completed').map((r) => r.body.actual_load_value)).toEqual([55]);
  expect(s3Writes(server).some((r) => r.body.status === 'completed' && r.body.actual_load_value === 50)).toBe(false);
  expect(results.errors).toEqual([]);
});

for (const how of ['refresh', 'reload']) {
  test(`legacy (no provenance, ${how}): the coach saves the prescribed 50 lb after the old Undo landed; it is kept and never treated as untouched`, async ({ page }) => {
    const { server, results } = await setup(page, { oldServer: true, seed: afterOldQuick });
    await seedLegacy(page, legacyBoth(), legacyMarks);
    await settled(page, LOG);
    server.coachSet('a-s3', { status: 'pending', actual_load_value: 50, actual_load_unit: 'lb', actual_reps: null });
    if (how === 'reload') { await page.reload(); await expect(page.getByTestId('workout-outline')).toBeVisible(); }
    else await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.locator('input[aria-label="Incline Press set 3 weight"]')).toHaveValue('50');
    const before = s3Writes(server).length;
    const target = await planTargetsShown(page);
    expect(target ?? '').not.toMatch(/set 3/);
    expect(s3Writes(server)).toHaveLength(before);
    await card(page, 'Incline Press').getByRole('button', { name: 'Complete set 3', exact: true }).click();
    await settled(page, LOG);
    expect(s3Writes(server).slice(before).map((r) => [r.body.status, r.body.actual_load_value])).toEqual([['completed', 50]]);
    expect(results.errors).toEqual([]);
  });
}

// LOOK-A-BULK-UI-REVIEW: the new tracker offers no bulk set completion. Done
// stays a flag, Finish is the guarded /finish, Undo still works, and nothing
// ever reaches the legacy /complete-all (kept on the server for old clients).
test('no bulk "Complete all remaining": Done, Undo and Finish work and /complete-all is never sent', async ({ page }) => {
  const { server, results } = await setup(page);
  await expect(page.getByRole('button', { name: /Complete all remaining/i })).toHaveCount(0);
  const before = rows(server, 'b');
  await card(page, 'Goblet Squat').getByTestId('exercise-quick-complete').click();
  await settled(page, LOG);
  expect(flag(server, 'b')).toBe(true);
  await undoButton(page).click();
  await settled(page, LOG);
  expect(flag(server, 'b')).toBe(false);
  await card(page, 'Goblet Squat').getByTestId('exercise-quick-complete').click();
  await settled(page, LOG);
  expect(rows(server, 'b')).toEqual(before);
  await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm completion', exact: true }).click();
  await expect.poll(() => sent(server, /\/finish$/).length).toBe(1);
  expect(sent(server, /\/complete-all$/)).toEqual([]);
  expect(sent(server, /\/complete$/)).toEqual([]);
  expect(rows(server, 'b')).toEqual(before);
  expect(results.errors).toEqual([]);
});
