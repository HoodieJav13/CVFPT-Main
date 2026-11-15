// Cross-device Undo (local migration 20261113000000, 2026-11-12; adapted to
// Look A 2026-11-15 per LOOK-A-BROWSER-CONTRACT-MAP + ADDENDUM).
//
// Two families, kept separate:
//  1. New server Undo: an individual set write and its revision-checked
//     server inverse restore the row's values AND provenance. Every device,
//     fresh browser and reload must then read the set as the untouched
//     prescription. The shortcut that writes values for the person is today's
//     plan ("Log set N · …"): it targets untouched sets only, never an
//     explicit entry (never stripped) or an unprovable load (never guessed).
//     Flag-only Done writes no set at all.
//  2. Legacy queued writes: the 2026-11-12 bulk quick complete and its
//     six-second Undo left set PATCHes and markers on devices. They are seeded
//     exactly as that build queued them, so their replay/hold/choice/Finish
//     protections (F1–F6) keep running against the current page.
// Normal mode,
// synthetic in-process API that keeps value_origin the way
// apply_workout_set_event_v2 and the set_value_origin_guard trigger do (and an
// OLD-server mode without the column). Two browser contexts share one server
// copy. Fictional data only. This proves UI behaviour and the writes the page
// sends, not server authorization or database rules (those are covered by
// supabase/tests/value_origin and backend/test/set-value-origin-mounted).
import { test, expect } from '@playwright/test';

const LOG = 'xd-log';
const SET_FIELDS = ['status', 'actual_load_value', 'actual_load_unit', 'actual_reps', 'actual_rpe'];
const pick = (set) => Object.fromEntries(SET_FIELDS.map((key) => [key, set[key] ?? null]));
const row = (n, extra = {}) => ({
  id: `a-s${n}`, workout_log_exercise_id: 'a', set_number: n, status: 'pending', set_origin: 'prescribed',
  actual_load_value: 50, actual_load_unit: 'lb', actual_reps: null, actual_rpe: null,
  actual_duration_value: null, actual_duration_unit: null, actual_distance_value: null, actual_distance_unit: null,
  revision: 0, last_actor_role: null, value_origin: 'legacy', value_origin_nonce: null, prefill_load_value: null, prefill_load_unit: null, ...extra,
});
// stamps: rows carry updated_at and every write moves it, as the real server
// does (Ultra F1/F2 additions, 2026-11-12; off for the earlier tests).
const stamp = (server) => { server.clock += 7; return new Date(server.clock).toISOString(); };
function serverCopy({ old = false, stamps = false } = {}) {
  const log = {
    id: LOG, client_id: 'xd-client', workout_name: 'Fictional cross-device workout', status: 'active', started_at: new Date().toISOString(),
    exercises: [{
      id: 'a', exercise_name: 'Incline Press', tracking_type: 'reps_weight', prescribed_sets: '4', prescribed_reps: '8', prescribed_load_value: 50, prescribed_load_unit: 'lb', prescribed_rest_seconds: 90, superset_group: null, plan_revision: 0, backups: [],
      sets: [row(1, { status: 'completed', actual_reps: 8, revision: 2, last_actor_role: 'client', value_origin: 'entered' }), row(2), row(3), row(4, { status: 'skipped', actual_load_value: null, actual_load_unit: null, revision: 1, value_origin: 'unknown' })],
    }],
    coach_responses: [], conflicts: [], substitutions: [],
  };
  const server = { log, old, stamps, writes: [], dones: [], events: new Map(), clock: Date.parse('2026-11-12T10:00:00Z'), hold: null, latest: null, undos: new Map(), finishes: new Map() };
  if (stamps) for (const set of log.exercises[0].sets) set.updated_at = stamp(server);
  return server;
}
// The 2026-11-12 bulk quick complete as that server recorded it (sets 2 and 3
// completed without a weight), so legacy queued Undo writes can follow it.
function afterOldQuick(server) {
  for (const id of ['a-s2', 'a-s3']) {
    applyWrite(server, findSet(server, id), { status: 'completed', actual_load_value: null, actual_load_unit: null, actual_reps: null, actual_rpe: null, value_origin: 'entered', event_id: `old-quick-${id}` });
    server.events.set(`old-quick-${id}`, 'applied');
  }
  return server;
}
// The fields a set write's server inverse puts back (values and provenance).
const RESTORE = [...SET_FIELDS, 'value_origin', 'value_origin_nonce', 'prefill_load_value', 'prefill_load_unit'];
const rowPrint = (set) => JSON.stringify([set.revision, ...SET_FIELDS.map((k) => set[k] ?? null)]);
const performed = (r) => ['actual_reps', 'actual_rpe', 'actual_duration_value', 'actual_distance_value'].some((k) => r[k] !== null && r[k] !== undefined && r[k] !== '');
const ORIGIN_KEYS = ['value_origin', 'value_origin_nonce', 'prefill_load_value', 'prefill_load_unit'];
const visible = (server, set) => {
  const copy = { ...set };
  if (server.old) for (const key of ORIGIN_KEYS) delete copy[key];
  return copy;
};
// apply_workout_set_event_v2 (applied outcome) and the guard, for a client write.
function applyWrite(server, set, body) {
  const untouched = set.status === 'pending' && !performed(set) && (set.value_origin === 'prefill' || (set.value_origin === 'legacy' && set.revision === 0 && !set.last_actor_role));
  const before = { ...set };
  for (const key of SET_FIELDS) if (key in body) set[key] = body[key];
  Object.assign(set, { revision: set.revision + 1, last_actor_role: 'client' });
  if (server.stamps) set.updated_at = stamp(server);
  const declared = server.old ? undefined : body.value_origin;
  if (!declared) return Object.assign(set, { value_origin: 'unknown', prefill_load_value: null, prefill_load_unit: null });
  const prefillOk = declared === 'prefill' && set.status === 'pending' && !performed(set) && before.prefill_load_value !== null
    && set.actual_load_value !== null && Number(set.actual_load_value) === Number(before.prefill_load_value) && (set.actual_load_unit ?? null) === before.prefill_load_unit;
  return Object.assign(set, {
    value_origin: declared === 'entered' ? 'entered' : prefillOk ? 'prefill' : 'unknown',
    value_origin_nonce: body.event_id,
    prefill_load_value: untouched ? before.actual_load_value : null,
    prefill_load_unit: untouched ? before.actual_load_unit : null,
  });
}
const findSet = (server, id) => server.log.exercises.flatMap((exercise) => exercise.sets).find((set) => set.id === id);
// The legacy no-event PATCH: the value and updated_at change, the revision and
// last event do not; the guard makes the origin unknown (new schema).
function legacyWrite(server, id, value) {
  const set = findSet(server, id);
  Object.assign(set, { status: 'pending', actual_load_value: value, actual_load_unit: 'lb', actual_reps: null, actual_rpe: null, value_origin: 'unknown', prefill_load_value: null, prefill_load_unit: null });
  if (server.stamps) set.updated_at = stamp(server);
}
// Another device's explicit entry (declared entered) at the next revision.
function otherDeviceEnters(server, set, value, extra = {}) {
  // The supplied actor role is kept (an explicit coach write stays a coach write).
  Object.assign(set, { ...extra, actual_load_value: value, actual_load_unit: 'lb', revision: set.revision + 1, last_actor_role: extra.last_actor_role ?? 'client', value_origin: 'entered', value_origin_nonce: 'other-device-event', prefill_load_value: null, prefill_load_unit: null });
  if (server.stamps) set.updated_at = stamp(server);
}

async function device(browser, server, { width = 390, height = 844, label = 'A', overrides = null, seed = null } = {}) {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width, height }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('cvf_access_token', 'synthetic-xd-token'));
  // Legacy queued writes and markers, as an older build left them (once per browser).
  if (seed) {
    await page.addInitScript(([outbox, prefill, value]) => {
      if (localStorage.getItem('xd_seeded')) return;
      localStorage.setItem(outbox, JSON.stringify(value.queue));
      localStorage.setItem(prefill, JSON.stringify(value.marks));
      localStorage.setItem('xd_seeded', '1');
    }, [`cvf_workout_outbox_${LOG}`, `cvf_workout_prefill_${LOG}`, seed]);
  }
  await page.route('**/api/**', async (route) => {
    const r = route.request();
    const path = new URL(r.url()).pathname.replace(/^\/api/, '');
    const method = r.method();
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/auth/me') return json({ role: 'client', email: 'xd@example.invalid', profile: { id: 'xd-client', name: 'Fictional cross-device client', waiver_signed: true } });
    if (path === '/telemetry/events') return route.fulfill({ status: 204 });
    if (path.endsWith('/unread-count')) return json({ unread: 0 });
    if (path === `/workout-logs/${LOG}` && method === 'GET') {
      if (server.hold) await server.hold;
      if (server.failGets) return json({ error: 'Synthetic read failure' }, 503);
      return json({ ...server.log, exercises: server.log.exercises.map((exercise) => ({ ...exercise, sets: exercise.sets.map((set) => visible(server, set)) })), server_time: new Date().toISOString() });
    }
    if (new RegExp(`^/workout-logs/${LOG}/exercises/[^/]+/history$`).test(path)) return json({ occurrences: [], next_cursor: null });
    if (new RegExp(`^/workout-logs/${LOG}/exercises/[^/]+/substitution-options$`).test(path)) return json({ backups: [], suggestions: [], catalog_reason: null, server_time: new Date().toISOString() });
    if (method === 'GET' && new RegExp(`^/workout-logs/${LOG}/exercises/[^/]+/cue-retry$`).test(path)) return json({ source_version: null, can_create: false, can_recheck: false, outgoing: [], incoming: [] });
    if (method === 'PATCH' && path.startsWith(`/workout-logs/${LOG}/sets/`)) {
      const setId = path.split('/').at(-1);
      const set = findSet(server, setId);
      const body = r.postDataJSON();
      server.writes.push({ device: label, setId, ...pick(body), value_origin: body.value_origin ?? null, base_revision: body.base_revision });
      // A repeated event id is answered like the real RPC: the CURRENT row, outcome replayed.
      if (body.event_id && server.events.has(body.event_id)) {
        // F6 addition: a test can keep the replayed answer in flight.
        if (server.replayGate) await server.replayGate;
        return json({ ...visible(server, set), event: { outcome: 'replayed', original_outcome: server.events.get(body.event_id) } });
      }
      const special = overrides?.(set, body);
      if (special?.lost) {
        // Committed, but the reply never reaches the page.
        applyWrite(server, set, body);
        server.events.set(body.event_id, 'applied');
        special.after?.(set);
        return route.abort('failed');
      }
      if (special) { server.events.set(body.event_id, special.outcome); return json({ ...visible(server, set), event: special }); }
      const before = Object.fromEntries(RESTORE.map((k) => [k, set[k] ?? null]));
      applyWrite(server, set, body);
      server.events.set(body.event_id, 'applied');
      // The newest change and its inverse (one step; any later row change ends it).
      server.latest = { id: body.event_id, setId, before, print: rowPrint(set) };
      return json({ ...visible(server, set), event: { outcome: 'applied', change: { id: body.event_id, undoable: true } } });
    }
    const exercisePrint = (exerciseId) => {
      const exercise = server.log.exercises.find((row) => row.id === exerciseId);
      return JSON.stringify([Boolean(exercise.not_set_tracked), exercise.sets.map(rowPrint)]);
    };
    const current = () => {
      const latest = server.latest;
      if (!latest) return null;
      if (latest.exerciseId) return exercisePrint(latest.exerciseId) === latest.print ? { change_id: latest.id, kind: 'exercise_done', result: { exercise_id: latest.exerciseId } } : null;
      return rowPrint(findSet(server, latest.setId)) === latest.print ? { change_id: latest.id, kind: 'set', result: { set_id: latest.setId } } : null;
    };
    const shown = () => ({ ...server.log, exercises: server.log.exercises.map((exercise) => ({ ...exercise, sets: exercise.sets.map((set) => visible(server, set)) })) });
    if (path === `/workout-logs/${LOG}/undo` && method === 'GET') return json({ undo: current() });
    if (method === 'POST' && path === `/workout-logs/${LOG}/undo`) {
      const body = r.postDataJSON();
      server.undoRequests = (server.undoRequests || 0) + 1;
      if (server.undos.has(body.event_id)) return json({ result: { outcome: 'replayed', original_outcome: server.undos.get(body.event_id) }, log: shown(), undo: current() });
      const live = current();
      if (!live || live.change_id !== body.change_id) {
        server.undos.set(body.event_id, 'refused');
        return json({ result: { outcome: 'refused', reason: 'Something changed since, so this cannot be undone.' }, log: shown(), undo: live });
      }
      if (server.latest.exerciseId) {
        server.log.exercises.find((row) => row.id === server.latest.exerciseId).not_set_tracked = false;
      } else {
        const set = findSet(server, server.latest.setId);
        Object.assign(set, server.latest.before, { revision: set.revision + 1, last_actor_role: 'client' });
        if (server.stamps) set.updated_at = stamp(server);
      }
      server.latest = null;
      server.undos.set(body.event_id, 'applied');
      return json({ result: { outcome: 'applied', undoes: body.change_id }, log: shown(), undo: null });
    }
    // Done: flag only (no set changes), once per event id; it becomes the one Undo.
    const doneMatch = method === 'POST' && path.match(new RegExp(`^/workout-logs/${LOG}/exercises/([^/]+)/done$`));
    if (doneMatch) {
      const body = r.postDataJSON();
      const exercise = server.log.exercises.find((row) => row.id === doneMatch[1]);
      if (server.events.has(body.event_id)) return json({ result: { outcome: 'replayed', original_outcome: server.events.get(body.event_id), change_id: body.event_id }, log: shown(), undo: current() });
      if (!exercise || exercise.not_set_tracked || server.log.status !== 'active') {
        server.events.set(body.event_id, 'refused');
        return json({ result: { outcome: 'refused', reason: 'This exercise is already done.' }, log: shown(), undo: current() });
      }
      exercise.not_set_tracked = true;
      server.events.set(body.event_id, 'applied');
      server.dones.push({ device: label, exerciseId: exercise.id, event_id: body.event_id });
      server.latest = { id: body.event_id, exerciseId: exercise.id, print: exercisePrint(exercise.id) };
      return json({ result: { outcome: 'applied', change_id: body.event_id }, log: shown(), undo: current() });
    }
    // Finish (F6): the Look A envelope, applied once per event id and counted
    // to catch a duplicate; the older /complete stays for old queued entries.
    if (method === 'POST' && path === `/workout-logs/${LOG}/finish`) {
      const body = r.postDataJSON();
      if (server.finishes.has(body.event_id)) return json({ result: { outcome: 'replayed', original_outcome: 'applied' }, log: shown(), undo: null });
      server.finishes.set(body.event_id, 'applied');
      server.completes = (server.completes || 0) + 1;
      server.log.status = 'completed';
      return json({ result: { outcome: 'applied' }, log: shown(), undo: null });
    }
    if (method === 'POST' && path === `/workout-logs/${LOG}/complete`) {
      server.completes = (server.completes || 0) + 1;
      server.log.status = 'completed';
      return json(shown());
    }
    return json({ error: `Unexpected synthetic route ${method} ${path}` }, 404);
  });
  await page.goto(`/client/workouts/${LOG}/track`);
  await expect(page.getByTestId('workout-outline')).toBeVisible();
  return { context, page, errors };
}

const done = (page) => page.getByTestId('tracker-exercise-card').first().getByTestId('exercise-quick-complete');
const settle = (page) => page.waitForFunction((key) => !localStorage.getItem(key), `cvf_workout_outbox_${LOG}`);
const since = (server, start) => server.writes.slice(start).map((w) => [w.device, w.setId, w.status, w.actual_load_value]);
const shot = (page, name) => page.screenshot({ path: test.info().outputPath(`${name}.png`) });
const completeSet = (page, n) => page.getByRole('button', { name: `Complete set ${n}`, exact: true });
const undoButton = (page) => page.getByTestId('workout-undo-button');

// Family 1: set 3 recorded on its own (the prefilled 50 lb), then the one Undo.
async function setThenUndo(page) {
  await completeSet(page, 3).click();
  await settle(page);
  await expect(undoButton(page)).toHaveText(/Undo set 3 of Incline Press/);
  await undoButton(page).click();
  await settle(page);
}
// Today's plan from set 2 logged as 8 × 50 lb: which set would it log next?
// ('untouched' and blank sets only: an entered or unprovable value keeps its own numbers.)
async function planTarget(page) {
  const input = page.locator('input[aria-label="Incline Press set 2 performed reps"]');
  await input.scrollIntoViewIfNeeded();
  await input.fill('8');
  await input.blur();
  await settle(page);
  await completeSet(page, 2).click();
  await settle(page);
  await page.getByTestId('tracker-exercise-card').first().getByTestId('plan-keep').click();
  const log = page.getByTestId('tracker-exercise-card').first().getByTestId('plan-log');
  return (await log.count()) ? log.getAttribute('aria-label') : null;
}
const TARGETS_SET_3 = 'Log Incline Press set 3 as 8 × 50 lb';
// Done is flag-only on every device: it writes no set.
// The Done request must actually succeed: the server holds the flag, the sets
// are byte-for-byte what they were, and the page shows the Undo for it.
async function doneWritesNoSet(page, server) {
  const start = server.writes.length;
  const doneStart = server.dones.length;
  const rows = JSON.stringify(server.log.exercises[0].sets);
  const answer = page.waitForResponse((response) => /\/exercises\/a\/done$/.test(new URL(response.url()).pathname));
  await done(page).click();
  const response = await answer;
  expect(response.status()).toBe(200);
  expect((await response.json()).result.outcome).toBe('applied');
  await settle(page);
  expect(server.dones.slice(doneStart)).toHaveLength(1);
  expect(server.log.exercises[0].not_set_tracked).toBe(true);
  expect(JSON.stringify(server.log.exercises[0].sets)).toBe(rows);
  expect(server.writes.slice(start)).toEqual([]);
  await expect(undoButton(page)).toContainText('Incline Press');
}
// Dev builds load LocalCueRetry lazily; load it before cutting the network so
// an offline step tests the tracker, not the dev server's module fetch.
async function goOffline(device) {
  await device.page.evaluate((chunk) => import(chunk), '/src/components/training/LocalCueRetry.jsx');
  await device.context.setOffline(true);
}

// Family 2: the two queued Undo writes of the 2026-11-12 build (prescribed
// 50 lb back, declared prefill, with its envelope) and this device's markers.
const legacyUndo = (setId) => ({
  id: `old-undo-${setId}`, attempts: 0, kind: 'set', exerciseId: 'a', setId, method: 'patch', url: `/workout-logs/${LOG}/sets/${setId}`,
  data: { status: 'pending', actual_load_value: 50, actual_load_unit: 'lb', actual_reps: null, actual_rpe: null, value_origin: 'prefill', event_id: `old-undo-${setId}`, base_revision: 1, local_seq: 1, offline: false, plan_revision_seen: 0 },
});
const LEGACY_SEED = { queue: [legacyUndo('a-s2'), legacyUndo('a-s3')], marks: { 'a-s2': { op: 'old-undo-a-s2', base: 1 }, 'a-s3': { op: 'old-undo-a-s3', base: 1 } } };

// ---------- Family 1: a set write and its server Undo ----------
// Rows as a workout started on the value-origin schema holds them: untouched
// prefills declared 'prefill' with their snapshot.
const prefillRows = (server) => {
  for (const id of ['a-s2', 'a-s3']) Object.assign(findSet(server, id), { value_origin: 'prefill', prefill_load_value: 50, prefill_load_unit: 'lb' });
  return server;
};

for (const [width, height] of [[390, 844], [320, 700]]) {
  test(`${width}×${height}: set 3 recorded and undone on device A; device B (fresh browser) reads it untouched: today's plan may log it, Done writes no set`, async ({ browser }) => {
    const server = prefillRows(serverCopy());
    const a = await device(browser, server, { width, height, label: 'A' });
    await setThenUndo(a.page);
    // The inverse put the values and the provenance back.
    expect(findSet(server, 'a-s3')).toMatchObject({ status: 'pending', actual_load_value: 50, actual_reps: null, value_origin: 'prefill', prefill_load_value: 50 });
    await shot(a.page, `A-after-undo-${width}x${height}`);
    const b = await device(browser, server, { width, height, label: 'B' });
    await expect(b.page.locator('input[aria-label="Incline Press set 3 weight"]')).toHaveValue('50');
    await shot(b.page, `B-fresh-device-${width}x${height}`);
    expect(await planTarget(b.page)).toBe(TARGETS_SET_3);
    await doneWritesNoSet(b.page, server);
    expect([...a.errors, ...b.errors]).toEqual([]);
    await a.context.close(); await b.context.close();
  });
}

test('same device after a reload, and the same browser with its storage cleared, still read the undone set as untouched', async ({ browser }) => {
  const server = prefillRows(serverCopy());
  const a = await device(browser, server);
  await setThenUndo(a.page);
  await a.page.reload();
  await expect(a.page.getByTestId('workout-outline')).toBeVisible();
  await a.page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.startsWith('cvf_workout_')) localStorage.removeItem(key); });
  await a.page.reload();
  await expect(a.page.getByTestId('workout-outline')).toBeVisible();
  expect(await planTarget(a.page)).toBe(TARGETS_SET_3);
  expect(a.errors).toEqual([]);
  await a.context.close();
});

test('a coach prescription change after set 3 was recorded ends its Undo: a stale tap is refused and set 3 keeps what was recorded', async ({ browser }) => {
  const server = prefillRows(serverCopy());
  const a = await device(browser, server);
  await completeSet(a.page, 3).click();
  await settle(a.page);
  await expect(undoButton(a.page)).toHaveText(/Undo set 3 of Incline Press/);
  // The coach edits the plan to 60 lb from another device (a material change; completed sets are not touched).
  Object.assign(server.log.exercises[0], { prescribed_load_value: 60, plan_revision: 1 });
  server.latest = null;
  await undoButton(a.page).click();
  await settle(a.page);
  expect([...server.undos.values()]).toEqual(['refused']);
  expect(findSet(server, 'a-s3')).toMatchObject({ status: 'completed', actual_load_value: 50 });
  await expect(undoButton(a.page)).toBeDisabled();
  const b = await device(browser, server, { label: 'B' });
  await expect(b.page.locator('[data-set-id="a-s3"] button[aria-label="Mark incomplete set 3"]')).toBeVisible();
  await expect(undoButton(b.page)).toBeDisabled();
  expect([...a.errors, ...b.errors]).toEqual([]);
  await a.context.close(); await b.context.close();
});

for (const how of ['refresh', 'reload']) {
  test(`finding 01 (${how}): another device's explicit 50 lb after the Undo is entered: today's plan never overwrites it, completing set 3 records 50`, async ({ browser }) => {
    const server = prefillRows(serverCopy());
    const a = await device(browser, server);
    await setThenUndo(a.page);
    otherDeviceEnters(server, findSet(server, 'a-s3'), 50, { last_actor_role: 'coach' });
    if (how === 'reload') { await a.page.reload(); await expect(a.page.getByTestId('workout-outline')).toBeVisible(); } else { await a.page.evaluate(() => window.dispatchEvent(new Event('online'))); }
    expect(await planTarget(a.page)).toBeNull();
    const start = server.writes.length;
    await completeSet(a.page, 3).click();
    await settle(a.page);
    expect(since(server, start)).toEqual([['A', 'a-s3', 'completed', 50]]);
    expect(a.errors).toEqual([]);
    await a.context.close();
  });
}

for (const [width, height] of [[390, 844], [320, 700]]) {
  test(`${width}×${height}: a load written by an old writer (unknown) is never treated as untouched or stripped; typing what you did records it`, async ({ browser }) => {
    const server = serverCopy();
    Object.assign(findSet(server, 'a-s3'), { revision: 3, last_actor_role: 'client', value_origin: 'unknown' });
    const a = await device(browser, server, { width, height });
    await expect(a.page.locator('input[aria-label="Incline Press set 3 weight"]')).toHaveValue('50');
    expect(server.writes).toEqual([]);
    expect(await planTarget(a.page)).toBeNull();
    await shot(a.page, `unknown-not-targeted-${width}x${height}`);
    const input = a.page.locator('input[aria-label="Incline Press set 3 performed reps"]');
    await input.scrollIntoViewIfNeeded();
    await input.fill('7');
    await input.blur();
    await settle(a.page);
    expect(server.writes.at(-1)).toMatchObject({ setId: 'a-s3', value_origin: 'entered', actual_reps: 7, actual_load_value: 50 });
    const start = server.writes.length;
    await completeSet(a.page, 3).click();
    await settle(a.page);
    expect(since(server, start)).toEqual([['A', 'a-s3', 'completed', 50]]);
    expect(a.errors).toEqual([]);
    await a.context.close();
  });
}

test('legacy rows: untouched at revision 0 when equal to the prescription; unprovable history is never targeted', async ({ browser }) => {
  const server = serverCopy();
  Object.assign(findSet(server, 'a-s3'), { actual_load_value: 45 });
  const a = await device(browser, server);
  expect(await planTarget(a.page)).toBeNull();
  await a.context.close();
  const fresh = serverCopy();
  const b = await device(browser, fresh, { label: 'B' });
  expect(await planTarget(b.page)).toBe(TARGETS_SET_3);
  expect([...a.errors, ...b.errors]).toEqual([]);
  await b.context.close();
});

test('a legacy-origin row recorded and undone reads as unprovable afterwards (revision moved): never targeted, its 50 lb kept', async ({ browser }) => {
  // Retained limit (receipt): the inverse restores 'legacy' at a new revision,
  // which no device can prove untouched; the conservative reading never guesses.
  const server = serverCopy();
  const a = await device(browser, server);
  await setThenUndo(a.page);
  expect(findSet(server, 'a-s3')).toMatchObject({ status: 'pending', actual_load_value: 50, value_origin: 'legacy' });
  const b = await device(browser, server, { label: 'B' });
  await expect(b.page.locator('input[aria-label="Incline Press set 3 weight"]')).toHaveValue('50');
  expect(await planTarget(b.page)).toBeNull();
  await doneWritesNoSet(b.page, server);
  expect([...a.errors, ...b.errors]).toEqual([]);
  await a.context.close(); await b.context.close();
});

test('old server (no origin column): after a set write and its Undo no device treats the set as untouched; own explicit saves are recorded as entered', async ({ browser }) => {
  const server = serverCopy({ old: true });
  const a = await device(browser, server, { label: 'A' });
  await setThenUndo(a.page);
  const b = await device(browser, server, { label: 'B' });
  expect(await planTarget(b.page)).toBeNull();
  await shot(b.page, 'old-server-B-not-targeted-390x844');
  // Device A saves an explicit 50 lb on set 3: its own entry, recorded as is.
  const load = a.page.locator('input[aria-label="Incline Press set 3 weight"]');
  await load.scrollIntoViewIfNeeded();
  await load.fill('50');
  await load.blur();
  await settle(a.page);
  const start = server.writes.length;
  await completeSet(a.page, 3).click();
  await settle(a.page);
  expect(since(server, start)).toEqual([['A', 'a-s3', 'completed', 50]]);
  expect([...a.errors, ...b.errors]).toEqual([]);
  await a.context.close(); await b.context.close();
});

// ---------- Family 2: legacy queued Undo writes (seeded) ----------
test('legacy: the old Undo loses to the coach\'s 55 lb (conflict): 55 is kept, never targeted, and completing set 3 records 55', async ({ browser }) => {
  const server = afterOldQuick(serverCopy());
  const a = await device(browser, server, {
    seed: LEGACY_SEED,
    overrides: (set, body) => {
      if (set.id !== 'a-s3' || body.status !== 'pending') return null;
      Object.assign(set, { status: 'pending', actual_load_value: 55, actual_load_unit: 'lb', actual_reps: null, revision: set.revision + 1, last_actor_role: 'coach', value_origin: 'entered', value_origin_nonce: 'coach-55' });
      return { outcome: 'conflict', conflict_id: 'xd-conflict' };
    },
  });
  await settle(a.page);
  await a.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(a.page.locator('input[aria-label="Incline Press set 3 weight"]')).toHaveValue('55');
  const start = server.writes.length;
  await completeSet(a.page, 3).click();
  await settle(a.page);
  expect(since(server, start)).toEqual([['A', 'a-s3', 'completed', 55]]);
  expect(a.errors).toEqual([]);
  await a.context.close();
});

// Ultra F1/F2 (2026-11-12): the marker must not override what the server row
// says. Rows carry updated_at here, as the real server does.
const weight = (page, n) => page.locator(`input[aria-label="Incline Press set ${n} weight"]`);
async function typeReps(page, server, n, value) {
  const input = page.locator(`input[aria-label="Incline Press set ${n} performed reps"]`);
  await input.scrollIntoViewIfNeeded();
  await input.fill(String(value));
  await input.blur();
  await settle(page);
}
const vectors = [['new', 50, 390, 844], ['new', 55, 320, 700], ['old', 50, 320, 700], ['old', 55, 390, 844]];

for (const [schema, value, width, height] of vectors) {
  test(`${width}×${height} F1 (${schema} server): a legacy write of ${value} lb after an acknowledged Undo is gated after reload, never stripped; typing what you did records it`, async ({ browser }) => {
    const server = afterOldQuick(serverCopy({ old: schema === 'old', stamps: true }));
    const a = await device(browser, server, { width, height, seed: LEGACY_SEED });
    await settle(a.page);
    const revision = findSet(server, 'a-s3').revision;
    legacyWrite(server, 'a-s3', value);
    expect(findSet(server, 'a-s3').revision).toBe(revision);
    await a.page.reload();
    await expect(a.page.getByTestId('workout-outline')).toBeVisible();
    await expect(weight(a.page, 3)).toHaveValue(String(value));
    await shot(a.page, `F1-${schema}-${value}-kept-${width}x${height}`);
    // Never targeted by today's plan (its value cannot be proved untouched).
    expect(await planTarget(a.page)).toBeNull();
    const start = server.writes.length;
    await typeReps(a.page, server, 3, 7);
    expect(server.writes.at(-1)).toMatchObject({ setId: 'a-s3', value_origin: 'entered', actual_reps: 7, actual_load_value: value });
    await completeSet(a.page, 3).click();
    await settle(a.page);
    expect(since(server, start + 1)).toEqual([['A', 'a-s3', 'completed', value]]);
    expect(a.errors).toEqual([]);
    await a.context.close();
  });

  test(`${width}×${height} F2 (${schema} server): Undo committed but its reply lost, another device enters ${value} lb, the retry is replayed; the value is held, then kept`, async ({ browser }) => {
    const server = afterOldQuick(serverCopy({ old: schema === 'old', stamps: true }));
    let lost = false;
    const a = await device(browser, server, {
      width, height, seed: LEGACY_SEED,
      overrides: (set, body) => {
        if (lost || set.id !== 'a-s3' || body.status !== 'pending') return null;
        lost = true;
        // Hold the page's next reads so the in-session state after the replay is observable.
        let release;
        server.hold = new Promise((resolve) => { release = resolve; });
        server.release = () => { server.hold = null; release(); };
        return { lost: true, after: (row) => otherDeviceEnters(server, row, value) };
      },
    });
    await settle(a.page);
    const undo = server.writes.filter((w) => w.setId === 'a-s3' && w.status === 'pending');
    expect(undo.length).toBe(2);
    expect(findSet(server, 'a-s3').actual_load_value).toBe(value);
    // The replayed reply is the server's current row: the set is held until a refresh shows it.
    // Mapped (F3, 2026-11-12): was "... Record sets one at a time, or wait a moment.", which invited a
    // per-set write of the held set's older screen values; the text now only asks to wait.
    await expect(setRow(a.page, 3).getByTestId('set-checking')).toBeVisible();
    await shot(a.page, `F2-${schema}-${value}-checking-${width}x${height}`);
    server.release();
    await expect(weight(a.page, 3)).toHaveValue(String(value));
    await expect(setRow(a.page, 3).getByTestId('set-checking')).toHaveCount(0);
    await shot(a.page, `F2-${schema}-${value}-after-refresh-${width}x${height}`);
    await a.page.reload();
    await expect(a.page.getByTestId('workout-outline')).toBeVisible();
    await expect(weight(a.page, 3)).toHaveValue(String(value));
    // The other device's value is entered input: today's plan never overwrites it.
    expect(await planTarget(a.page)).toBeNull();
    const start = server.writes.length;
    if (schema === 'old') await typeReps(a.page, server, 3, 7);
    await completeSet(a.page, 3).click();
    await settle(a.page);
    expect(since(server, start).filter((w) => w[2] === 'completed')).toEqual([['A', 'a-s3', 'completed', value]]);
    expect(server.writes.some((w) => w.setId === 'a-s3' && w.status === 'completed' && w.actual_load_value === null && server.writes.indexOf(w) >= start)).toBe(false);
    expect(a.errors).toEqual([]);
    await a.context.close();
  });
}

test('legacy: an old Undo write whose reply is lost is replayed with no other writer; the server origin keeps it untouched', async ({ browser }) => {
  const server = afterOldQuick(serverCopy({ stamps: true }));
  let lost = false;
  const a = await device(browser, server, {
    seed: LEGACY_SEED,
    overrides: (set, body) => {
      if (lost || set.id !== 'a-s3' || body.status !== 'pending') return null;
      lost = true;
      return { lost: true };
    },
  });
  await settle(a.page);
  expect(server.writes.filter((w) => w.setId === 'a-s3' && w.status === 'pending').length).toBe(2);
  expect(findSet(server, 'a-s3').value_origin).toBe('prefill');
  await a.page.reload();
  await expect(a.page.getByTestId('workout-outline')).toBeVisible();
  // The server origin says untouched: today's plan may log it; Done writes no set.
  expect(await planTarget(a.page)).toBe(TARGETS_SET_3);
  await doneWritesNoSet(a.page, server);
  expect(a.errors).toEqual([]);
  await a.context.close();
});

// F3 (independent re-review of 56e9c65a, 2026-11-12): while a set is held after a replayed reply,
// no route may write the screen's older values for it. The server applies any write from the same
// actor whatever its base revision, so the page itself must not send one.
const setRow = (page, n) => page.locator(`[data-set-id="a-s${n}"]`);
const repsInput = (page, n) => page.locator(`input[aria-label="Incline Press set ${n} performed reps"]`);
const writesFor = (server, start, setId) => server.writes.slice(start).filter((w) => w.setId === setId);
async function heldAfterReplay(browser, { schema, value, width = 390, height = 844, failReads = false, beforeReplay = null, other = {} }) {
  const server = afterOldQuick(serverCopy({ old: schema === 'old', stamps: true }));
  let lost = false;
  const a = await device(browser, server, {
    width, height, seed: LEGACY_SEED,
    overrides: (set, body) => {
      if (lost || set.id !== 'a-s3' || body.status !== 'pending') return null;
      lost = true;
      if (failReads) server.failGets = true;
      else {
        let release;
        server.hold = new Promise((resolve) => { release = resolve; });
        server.release = () => { server.hold = null; release(); };
      }
      return { lost: true, after: (row) => otherDeviceEnters(server, row, value, other) };
    },
  });
  if (beforeReplay) {
    await expect.poll(() => server.writes.filter((w) => w.setId === 'a-s3' && w.status === 'pending').length).toBe(1);
    await beforeReplay(a.page);
  }
  await settle(a.page);
  expect(server.writes.filter((w) => w.setId === 'a-s3' && w.status === 'pending').length).toBe(2);
  await expect(setRow(a.page, 3).getByTestId('set-checking')).toBeVisible();
  return { server, a };
}

for (const [schema, value, width, height] of [['new', 55, 390, 844], ['old', 55, 320, 700], ['new', 50, 320, 700], ['old', 50, 390, 844]]) {
  test(`${width}×${height} F3 (${schema} server, other device entered ${value} lb): while held, Complete, typing and blur on set 3 send nothing; set 2 stays usable; after the refresh the server's value is recorded`, async ({ browser }) => {
    const { server, a } = await heldAfterReplay(browser, { schema, value, width, height });
    const start = server.writes.length;
    await a.page.getByRole('button', { name: 'Complete set 3', exact: true }).click();
    await expect(weight(a.page, 3)).not.toBeEditable();
    await expect(repsInput(a.page, 3)).not.toBeEditable();
    await weight(a.page, 3).focus();
    await a.page.keyboard.type('7');
    await a.page.keyboard.press('Tab');
    await repsInput(a.page, 3).focus();
    await a.page.keyboard.type('8');
    await a.page.keyboard.press('Tab');
    await a.page.waitForTimeout(400);
    expect(writesFor(server, start, 'a-s3')).toEqual([]);
    expect(findSet(server, 'a-s3')).toMatchObject({ status: 'pending', actual_load_value: value, revision: 3 });
    await expect(repsInput(a.page, 3)).toHaveValue('');
    await shot(a.page, `F3-${schema}-${value}-held-${width}x${height}`);
    // Another set is not held.
    await repsInput(a.page, 2).fill('6');
    await repsInput(a.page, 2).blur();
    await expect.poll(() => writesFor(server, start, 'a-s2').length).toBe(1);
    expect(writesFor(server, start, 'a-s2')[0]).toMatchObject({ actual_reps: 6 });
    // The delayed read lands: the screen shows the server's values and set 3 can be changed again.
    server.release();
    await expect(weight(a.page, 3)).toHaveValue(String(value));
    await expect(setRow(a.page, 3).getByTestId('set-checking')).toHaveCount(0);
    await expect(weight(a.page, 3)).toBeEditable();
    const after = server.writes.length;
    await a.page.getByRole('button', { name: 'Complete set 3', exact: true }).click();
    await settle(a.page);
    expect(writesFor(server, after, 'a-s3')).toEqual([expect.objectContaining({ status: 'completed', actual_load_value: value, base_revision: 3 })]);
    expect(findSet(server, 'a-s3')).toMatchObject({ status: 'completed', actual_load_value: value });
    expect(a.errors).toEqual([]);
    await a.context.close();
  });
}

for (const [schema, width, height] of [['new', 390, 844], ['old', 320, 700]]) {
  test(`${width}×${height} F3 (${schema} server): failed and offline reads keep the hold; it lifts only when a read after reconnecting lands`, async ({ browser }) => {
    test.setTimeout(60_000);
    const { server, a } = await heldAfterReplay(browser, { schema, value: 55, width, height, failReads: true });
    const start = server.writes.length;
    // Past the 10 s refresh interval: every read fails, the hold stays.
    await a.page.waitForTimeout(11_000);
    await expect(setRow(a.page, 3).getByTestId('set-checking')).toBeVisible();
    await a.page.getByRole('button', { name: 'Complete set 3', exact: true }).click();
    await a.context.setOffline(true);
    server.failGets = false;
    await a.page.waitForTimeout(600);
    await a.page.getByRole('button', { name: 'Complete set 3', exact: true }).click();
    await expect(setRow(a.page, 3).getByTestId('set-checking')).toBeVisible();
    await expect(weight(a.page, 3)).toHaveValue('50');
    expect(writesFor(server, start, 'a-s3')).toEqual([]);
    await shot(a.page, `F3-${schema}-offline-held-${width}x${height}`);
    await a.context.setOffline(false);
    await expect(weight(a.page, 3)).toHaveValue('55');
    await expect(setRow(a.page, 3).getByTestId('set-checking')).toHaveCount(0);
    await a.page.getByRole('button', { name: 'Complete set 3', exact: true }).click();
    await settle(a.page);
    expect(writesFor(server, start, 'a-s3')).toEqual([expect.objectContaining({ status: 'completed', actual_load_value: 55, base_revision: 3 })]);
    expect(a.errors).toEqual([]);
    await a.context.close();
  });
}

// Mapped (independent review of f284a1e6, 2026-11-12): this test was "a draft typed before the replay
// keeps its typed value and its original base revision" and asserted only { actual_reps: 9,
// base_revision: 1 }. It missed that the whole draft row, including the untouched older weight 50,
// was saved over the other device's 55 (the server applies a same-actor write whatever its base).
// Drafts now keep only the edited fields; the saved row is the server's row plus the typed reps.
for (const [schema, width, height] of [['new', 390, 844], ['old', 320, 700]]) {
  test(`${width}×${height} stale draft (${schema} server): reps typed before the replay are kept and saved with the other device's newer 55 lb, never the untouched older 50`, async ({ browser }) => {
    const { server, a } = await heldAfterReplay(browser, {
      schema, value: 55, width, height,
      beforeReplay: async (page) => { await repsInput(page, 3).fill('9'); },
    });
    const start = server.writes.length;
    await expect(repsInput(a.page, 3)).toHaveValue('9');
    // Held: neither Complete nor leaving the field writes anything.
    await a.page.getByRole('button', { name: 'Complete set 3', exact: true }).click();
    await a.page.getByTestId('workout-outline').click();
    await a.page.waitForTimeout(300);
    expect(writesFor(server, start, 'a-s3')).toEqual([]);
    server.release();
    await expect(setRow(a.page, 3).getByTestId('set-checking')).toHaveCount(0);
    await expect(repsInput(a.page, 3)).toHaveValue('9');
    await expect(weight(a.page, 3)).toHaveValue('55');
    await expect(setRow(a.page, 3).getByTestId('set-choice')).toHaveCount(0);
    await shot(a.page, `stale-draft-${schema}-merged-${width}x${height}`);
    await repsInput(a.page, 3).focus();
    await repsInput(a.page, 3).blur();
    await settle(a.page);
    expect(writesFor(server, start, 'a-s3')).toEqual([expect.objectContaining({ actual_reps: 9, actual_load_value: 55, base_revision: 3 })]);
    expect(findSet(server, 'a-s3')).toMatchObject({ actual_reps: 9, actual_load_value: 55, status: 'pending' });
    await a.page.getByRole('button', { name: 'Complete set 3', exact: true }).click();
    await settle(a.page);
    expect(findSet(server, 'a-s3')).toMatchObject({ actual_reps: 9, actual_load_value: 55, status: 'completed' });
    expect(server.writes.some((w) => w.setId === 'a-s3' && w.actual_load_value === 50 && server.writes.indexOf(w) >= start)).toBe(false);
    expect(a.errors).toEqual([]);
    await a.context.close();
  });
}

for (const [schema, choice, width, height] of [['new', 'mine', 390, 844], ['old', 'saved', 320, 700], ['old', 'mine', 390, 844], ['new', 'saved', 320, 700]]) {
  test(`${width}×${height} stale draft (${schema} server): the other device also changed reps; nothing is written until "${choice === 'mine' ? 'Save mine' : 'Use saved'}", which does exactly that`, async ({ browser }) => {
    const { server, a } = await heldAfterReplay(browser, {
      schema, value: 55, width, height, other: { actual_reps: 8 },
      beforeReplay: async (page) => { await repsInput(page, 3).fill('9'); },
    });
    const start = server.writes.length;
    server.release();
    const box = setRow(a.page, 3).getByTestId('set-choice');
    await expect(box).toContainText('Reps');
    await expect(box).toContainText('saved: 8');
    await expect(box).toContainText('yours: 9');
    await expect(repsInput(a.page, 3)).not.toBeEditable();
    await expect(weight(a.page, 3)).toHaveValue('55');
    await a.page.getByRole('button', { name: 'Complete set 3', exact: true }).click();
    await repsInput(a.page, 3).focus();
    await repsInput(a.page, 3).blur();
    await a.page.waitForTimeout(400);
    expect(writesFor(server, start, 'a-s3')).toEqual([]);
    await shot(a.page, `stale-draft-${schema}-choice-${width}x${height}`);
    if (choice === 'mine') {
      await box.getByRole('button', { name: 'Save mine' }).click();
      await settle(a.page);
      expect(writesFor(server, start, 'a-s3')).toEqual([expect.objectContaining({ actual_reps: 9, actual_load_value: 55, base_revision: 3 })]);
      await expect(repsInput(a.page, 3)).toHaveValue('9');
    } else {
      await box.getByRole('button', { name: 'Use saved' }).click();
      await expect(repsInput(a.page, 3)).toHaveValue('8');
      await a.page.waitForTimeout(300);
      expect(writesFor(server, start, 'a-s3')).toEqual([]);
      await a.page.getByRole('button', { name: 'Complete set 3', exact: true }).click();
      await settle(a.page);
      expect(writesFor(server, start, 'a-s3')).toEqual([expect.objectContaining({ status: 'completed', actual_reps: 8, actual_load_value: 55, base_revision: 3 })]);
    }
    await expect(box).toHaveCount(0);
    await expect(repsInput(a.page, 3)).toBeEditable();
    expect(a.errors).toEqual([]);
    await a.context.close();
  });
}

// F5 (independent review of fb1d7df2, 2026-11-13): a set-3 write queued BEFORE the Undo retry is answered
// as replayed. The reply is the server's current row (another device's 55 lb at revision 3); the queued
// write must not be sent with its stale whole row.
async function queuedBeforeReplay(browser, { schema, width = 390, height = 844, act }) {
  const server = afterOldQuick(serverCopy({ old: schema === 'old', stamps: true }));
  let lost = false;
  const a = await device(browser, server, {
    width, height, seed: LEGACY_SEED,
    overrides: (set, body) => {
      if (lost || set.id !== 'a-s3' || body.status !== 'pending') return null;
      lost = true;
      let release;
      server.hold = new Promise((resolve) => { release = resolve; });
      server.release = () => { server.hold = null; release(); };
      return { lost: true, after: (row) => otherDeviceEnters(server, row, 55) };
    },
  });
  await expect.poll(() => server.writes.filter((w) => w.setId === 'a-s3' && w.status === 'pending').length).toBe(1);
  const start = server.writes.length;
  await act(a.page, server);
  return { server, a, start };
}
const CHOICE = 'Set 3 was also changed on another device. Choose which values to keep first.';

for (const [schema, width, height] of [['new', 390, 844], ['old', 320, 700]]) {
  test(`${width}×${height} F5 (${schema} server): reps saved (blur) before the replay are sent with the other device's 55 lb, never the queued stale 50`, async ({ browser }) => {
    const { server, a, start } = await queuedBeforeReplay(browser, {
      schema, width, height,
      act: async (page) => { await repsInput(page, 3).fill('9'); await repsInput(page, 3).blur(); },
    });
    // The read stays held; the queue still drains: the queued save is re-checked against the replay's row.
    await settle(a.page);
    const sent = writesFor(server, start, 'a-s3');
    expect(sent.at(-1)).toMatchObject({ actual_reps: 9, actual_load_value: 55, base_revision: 3 });
    expect(sent.some((w) => w.actual_reps === 9 && w.actual_load_value === 50)).toBe(false);
    expect(findSet(server, 'a-s3')).toMatchObject({ actual_reps: 9, actual_load_value: 55, status: 'pending' });
    await shot(a.page, `F5-${schema}-queued-reps-${width}x${height}`);
    server.release();
    await expect(setRow(a.page, 3).getByTestId('set-checking')).toHaveCount(0);
    await expect(weight(a.page, 3)).toHaveValue('55');
    await expect(repsInput(a.page, 3)).toHaveValue('9');
    expect(a.errors).toEqual([]);
    await a.context.close();
  });
}

for (const [schema, choice, reload, width, height] of [['new', 'saved', false, 390, 844], ['old', 'mine', true, 320, 700], ['old', 'saved', true, 390, 844], ['new', 'mine', false, 320, 700]]) {
  test(`${width}×${height} F5 (${schema} server${reload ? ', reload' : ''}): Complete queued before the replay waits for an explicit choice; "${choice === 'mine' ? 'Save mine' : 'Use saved'}" does exactly that; another set keeps saving`, async ({ browser }) => {
    const { server, a, start } = await queuedBeforeReplay(browser, {
      schema, width, height,
      act: async (page) => { await page.getByRole('button', { name: 'Complete set 3', exact: true }).click(); },
    });
    // Only the Undo retry reaches the server (answered as replayed); the queued Complete waits.
    await expect.poll(() => writesFor(server, start, 'a-s3').length).toBe(1);
    await a.page.waitForTimeout(500);
    expect(writesFor(server, start, 'a-s3')).toEqual([expect.objectContaining({ status: 'pending', actual_load_value: 50 })]);
    // An unrelated set is not held back.
    await repsInput(a.page, 2).fill('6');
    await repsInput(a.page, 2).blur();
    await expect.poll(() => writesFor(server, start, 'a-s2').some((w) => w.actual_reps === 6)).toBe(true);
    server.release();
    if (reload) {
      // The parked write is durable: it survives a reload and is still not sent.
      await a.page.reload();
      await expect(a.page.getByTestId('workout-outline')).toBeVisible();
    }
    const box = setRow(a.page, 3).getByTestId('set-choice');
    await expect(box).toContainText('Weight');
    await expect(box).toContainText('saved: 55');
    await expect(box).toContainText('yours: 50');
    // The screen shows the queued Complete; changing set 3 again is refused until the choice.
    await a.page.getByRole('button', { name: 'Mark incomplete set 3', exact: true }).click();
    await expect(a.page.getByText(CHOICE)).toBeVisible();
    await expect(repsInput(a.page, 3)).not.toBeEditable();
    await a.page.waitForTimeout(300);
    expect(writesFor(server, start, 'a-s3')).toHaveLength(1);
    expect(findSet(server, 'a-s3')).toMatchObject({ status: 'pending', actual_load_value: 55 });
    await shot(a.page, `F5-${schema}-queued-complete-choice-${width}x${height}`);
    await box.getByRole('button', { name: choice === 'mine' ? 'Save mine' : 'Use saved' }).click();
    await settle(a.page);
    const expected = choice === 'mine' ? 50 : 55;
    expect(writesFor(server, start, 'a-s3').at(-1)).toMatchObject({ status: 'completed', actual_load_value: expected, base_revision: 3 });
    expect(findSet(server, 'a-s3')).toMatchObject({ status: 'completed', actual_load_value: expected });
    await expect(box).toHaveCount(0);
    expect(a.errors).toEqual([]);
    await a.context.close();
  });
}

// F6 (independent review of 305da672, 2026-11-13): Finish must never hide a parked choice behind
// "waiting for a connection". The person is kept where the choice can be made, or sent back to it.
const finishButton = (page) => page.getByRole('button', { name: 'Finish workout', exact: true });
const confirmFinish = (page) => page.getByRole('button', { name: 'Confirm completion', exact: true });
const DETAIL = new RegExp(`/client/workouts/${LOG}$`);
const choiceBox = (page) => setRow(page, 3).getByTestId('set-choice');
async function choose(page, choice) {
  const box = choiceBox(page);
  await expect(box).toContainText('saved: 55');
  await expect(box).toContainText('yours: 50');
  await box.getByRole('button', { name: choice === 'mine' ? 'Save mine' : 'Use saved' }).click();
}

for (const [schema, choice, path, width, height] of [['new', 'saved', 'resolve', 390, 844], ['old', 'mine', 'confirm', 320, 700], ['old', 'saved', 'resolve', 320, 700], ['new', 'mine', 'confirm', 390, 844]]) {
  test(`${width}×${height} F6 (${schema} server, ${path}): Finish says which set needs a choice; Resolve or Confirm keeps the person at the choice; after it the workout completes once`, async ({ browser }) => {
    const { server, a, start } = await queuedBeforeReplay(browser, {
      schema, width, height,
      act: async (page) => { await page.getByRole('button', { name: 'Complete set 3', exact: true }).click(); },
    });
    await expect.poll(() => writesFor(server, start, 'a-s3').length).toBe(1);
    server.release();
    await expect(choiceBox(a.page)).toBeVisible();
    await finishButton(a.page).click();
    const blocked = a.page.getByTestId('finish-blocked');
    await expect(blocked).toContainText('Set 3 of Incline Press was also changed on another device. Choose which values to keep before finishing.');
    await shot(a.page, `F6-${schema}-finish-blocked-${width}x${height}`);
    if (path === 'resolve') {
      await blocked.getByRole('button', { name: 'Resolve set 3' }).click();
    } else {
      await confirmFinish(a.page).click();
      await expect(a.page.getByTestId('finished-locally-banner')).toContainText('Set 3 of Incline Press needs your choice');
      expect(await a.page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]').map((operation) => operation.kind), `cvf_workout_outbox_${LOG}`)).toEqual(['set', 'complete']);
    }
    await expect(a.page.getByTestId('workout-completion-dialog')).toHaveCount(0);
    await expect(choiceBox(a.page).getByRole('button', { name: 'Use saved' })).toBeInViewport();
    expect(a.page.url()).toMatch(/\/track$/);
    expect(server.completes ?? 0).toBe(0);
    await choose(a.page, choice);
    if (path === 'resolve') {
      await settle(a.page);
      await finishButton(a.page).click();
      await expect(a.page.getByTestId('finish-blocked')).toHaveCount(0);
      await confirmFinish(a.page).click();
    }
    await expect(a.page).toHaveURL(DETAIL);
    await expect(a.page.getByTestId('waiting-to-sync-banner')).toHaveCount(0);
    expect(server.completes).toBe(1);
    expect(server.log.status).toBe('completed');
    expect(findSet(server, 'a-s3')).toMatchObject({ status: 'completed', actual_load_value: choice === 'mine' ? 50 : 55 });
    expect(a.errors).toEqual([]);
    await a.context.close();
  });
}

test('F6: an unsaved draft that needs a choice cannot go with Finish: Confirm is disabled with the reason until the choice', async ({ browser }) => {
  const { server, a } = await heldAfterReplay(browser, {
    schema: 'new', value: 55, width: 390, height: 844, other: { actual_reps: 8 },
    beforeReplay: async (page) => { await repsInput(page, 3).fill('9'); },
  });
  server.release();
  await expect(choiceBox(a.page)).toBeVisible();
  await finishButton(a.page).click();
  await expect(a.page.getByTestId('finish-blocked')).toContainText('Choose which values to keep before finishing.');
  await expect(confirmFinish(a.page)).toBeDisabled();
  await a.page.getByTestId('finish-blocked').getByRole('button', { name: 'Resolve set 3' }).click();
  await choiceBox(a.page).getByRole('button', { name: 'Save mine' }).click();
  await settle(a.page);
  await finishButton(a.page).click();
  await confirmFinish(a.page).click();
  await expect(a.page).toHaveURL(DETAIL);
  expect(server.completes).toBe(1);
  expect(findSet(server, 'a-s3')).toMatchObject({ actual_reps: 9, actual_load_value: 55 });
  expect(a.errors).toEqual([]);
  await a.context.close();
});

for (const [schema, choice, reload, width, height] of [['new', 'mine', false, 390, 844], ['old', 'saved', true, 320, 700]]) {
  test(`${width}×${height} F6 (${schema} server${reload ? ', reload' : ''}): Finish confirmed while the replay is in flight stays in the tracker with the reason; the choice there completes the queued Finish once`, async ({ browser }) => {
    let openGate;
    const { server, a, start } = await queuedBeforeReplay(browser, {
      schema, width, height,
      act: async (page, server) => {
        server.replayGate = new Promise((resolve) => { openGate = resolve; });
        await page.getByRole('button', { name: 'Complete set 3', exact: true }).click();
        await finishButton(page).click();
        await confirmFinish(page).click();
      },
    });
    // The retry is answered (replayed) only now; the queued Complete parks and Finish waits behind it.
    await expect.poll(() => writesFor(server, start, 'a-s3').length).toBe(1);
    server.replayGate = null;
    openGate();
    await a.page.waitForTimeout(800);
    expect(a.page.url()).toMatch(/\/track$/);
    // The read is still held: the banner says the set is checking (not waiting for a connection).
    await expect(a.page.getByTestId('finished-locally-banner')).toContainText('Set 3 of Incline Press is checking for newer saved values');
    expect(server.completes ?? 0).toBe(0);
    const queue = await a.page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), `cvf_workout_outbox_${LOG}`);
    expect(queue.map((operation) => operation.kind)).toEqual(['set', 'complete']);
    server.release();
    if (reload) {
      await a.page.reload();
      await expect(a.page.getByTestId('workout-outline')).toBeVisible();
    }
    await expect(a.page.getByTestId('finished-locally-banner')).toContainText('Set 3 of Incline Press needs your choice');
    await shot(a.page, `F6-${schema}-finish-queued-choice-${width}x${height}`);
    await choiceBox(a.page).getByRole('button', { name: 'Use saved' }).scrollIntoViewIfNeeded();
    await choose(a.page, choice);
    await expect(a.page).toHaveURL(DETAIL);
    expect(server.completes).toBe(1);
    expect(findSet(server, 'a-s3')).toMatchObject({ status: 'completed', actual_load_value: choice === 'mine' ? 50 : 55 });
    expect(a.errors).toEqual([]);
    await a.context.close();
  });
}

for (const [schema, choice, width, height] of [['new', 'saved', 390, 844], ['old', 'mine', 320, 700]]) {
  test(`${width}×${height} F6 (${schema} server): Finish offline, then a write parks while the detail page syncs: it says a choice is needed and goes back to tracking; the choice completes once`, async ({ browser }) => {
    const server = afterOldQuick(serverCopy({ old: schema === 'old', stamps: true }));
    let lost = false;
    const a = await device(browser, server, {
      width, height, seed: LEGACY_SEED,
      overrides: (set, body) => {
        if (lost || set.id !== 'a-s3' || body.status !== 'pending') return null;
        lost = true;
        return { lost: true, after: (row) => otherDeviceEnters(server, row, 55) };
      },
    });
    await expect.poll(() => server.writes.filter((w) => w.setId === 'a-s3' && w.status === 'pending').length).toBe(1);
    await goOffline(a);
    await a.page.getByRole('button', { name: 'Complete set 3', exact: true }).click();
    await finishButton(a.page).click();
    await confirmFinish(a.page).click();
    await expect(a.page).toHaveURL(DETAIL);
    await a.context.setOffline(false);
    const banner = a.page.getByTestId('waiting-to-sync-banner');
    await expect(banner).toContainText('needs your choice');
    await expect(banner).not.toContainText('when a connection returns');
    expect(server.completes ?? 0).toBe(0);
    await shot(a.page, `F6-${schema}-detail-choice-${width}x${height}`);
    await banner.getByRole('button', { name: 'Back to tracking' }).click();
    await expect(a.page).toHaveURL(/\/track$/);
    await choiceBox(a.page).getByRole('button', { name: 'Use saved' }).scrollIntoViewIfNeeded();
    await choose(a.page, choice);
    await expect(a.page).toHaveURL(DETAIL);
    expect(server.completes).toBe(1);
    expect(findSet(server, 'a-s3')).toMatchObject({ status: 'completed', actual_load_value: choice === 'mine' ? 50 : 55 });
    expect(a.errors).toEqual([]);
    await a.context.close();
  });
}
