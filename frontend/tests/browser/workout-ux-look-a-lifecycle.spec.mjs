// Look A one-step Undo across its lifecycle (LOOK-A-FRONTEND-LIFECYCLE-REVIEW,
// LOOK-A-PENDING-FINISH-REVIEW, 2026-11-14). A stateful synthetic server mirrors the
// local SQL rules the page relies on: an event id is the change id and replays
// its first answer; Undo inverts only the newest change and only while nothing
// material changed since; a replayed Finish that was undone says so. Normal
// mode, fictional data only. This proves page behaviour and the requests sent,
// not the database rules themselves (supabase/tests/look_a covers those).
import { test, expect } from '@playwright/test';

const LOG = 'la-log';
const OUTBOX = `cvf_workout_outbox_${LOG}`;
const row = (exercise, n, extra = {}) => ({
  id: `${exercise}-s${n}`, workout_log_exercise_id: exercise, set_number: n, status: 'pending', set_origin: 'prescribed',
  actual_load_value: 50, actual_load_unit: 'lb', actual_reps: null, actual_rpe: null,
  actual_duration_value: null, actual_duration_unit: null, actual_distance_value: null, actual_distance_unit: null,
  revision: 0, last_actor_role: null, value_origin: 'prefill', value_origin_nonce: null, archived: false, ...extra,
});
const exercise = (id, name, extra = {}) => ({
  id, exercise_name: name, tracking_type: 'reps_weight', prescribed_sets: '3', prescribed_reps: '8', prescribed_load_value: 50, prescribed_load_unit: 'lb',
  prescribed_rest_seconds: 60, superset_group: null, plan_revision: 0, backups: [], not_set_tracked: false,
  sets: [row(id, 1), row(id, 2), row(id, 3)], ...extra,
});
const SET_FIELDS = ['status', 'actual_load_value', 'actual_load_unit', 'actual_reps', 'actual_rpe'];
const clone = (value) => JSON.parse(JSON.stringify(value));
// What a change is checked against (the server's material fingerprint, simplified).
const material = (log) => JSON.stringify([log.status, log.exercises.map((e) => [e.id, e.not_set_tracked, e.sets.map((s) => [s.id, ...SET_FIELDS.map((k) => s[k])])])]);

function makeServer() {
  const server = {
    log: {
      id: LOG, client_id: 'la-client', workout_name: 'Fictional Look A workout', status: 'active', started_at: new Date().toISOString(),
      not_set_tracked: false, exercises: [exercise('a', 'Incline Press'), exercise('b', 'Goblet Squat')], coach_responses: [], conflicts: [], substitutions: [],
    },
    changes: new Map(), order: [], requests: [], holds: new Map(), drop: new Set(), down: false,
  };
  server.find = (setId) => server.log.exercises.flatMap((e) => e.sets).find((s) => s.id === setId);
  server.current = () => {
    const id = server.order.at(-1);
    const change = id && server.changes.get(id);
    if (!change || change.outcome !== 'applied' || change.undone || !change.inverse || change.after !== material(server.log)) return null;
    return { change_id: id, kind: change.kind, result: change.result };
  };
  server.record = (id, kind, request, outcome, inverse, result = {}, reason = null) => {
    const change = { kind, request, outcome, inverse, result, reason, after: outcome === 'applied' ? material(server.log) : null, undone: false };
    server.changes.set(id, change);
    if (outcome === 'applied') server.order.push(id);
    return change;
  };
  return server;
}

async function setup(page, { width = 390, height = 844 } = {}) {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const server = makeServer();
  const results = { errors: [], unexpected: [], navigations: [] };
  page.on('pageerror', (error) => results.errors.push(error.message));
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) results.navigations.push(new URL(frame.url()).pathname); });
  // Context-wide, so a second tab of this browser reaches the same server.
  await page.context().addInitScript(() => localStorage.setItem('cvf_access_token', 'synthetic-la-token'));
  await page.context().route('**/api/**', async (route) => {
    const r = route.request();
    const path = new URL(r.url()).pathname.replace(/^\/api/, '');
    const method = r.method();
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/auth/me') return json({ role: 'client', email: 'la@example.invalid', profile: { id: 'la-client', name: 'Fictional Look A client', waiver_signed: true } });
    if (path === '/telemetry/events') return route.fulfill({ status: 204 });
    if (path.endsWith('/unread-count')) return json({ unread: 0 });
    if (path === `/workout-logs/${LOG}` && method === 'GET') return json({ ...clone(server.log), server_time: new Date().toISOString() });
    if (new RegExp(`^/workout-logs/${LOG}/exercises/[^/]+/history$`).test(path)) return json({ occurrences: [], next_cursor: null });
    if (new RegExp(`^/workout-logs/${LOG}/exercises/[^/]+/substitution-options$`).test(path)) return json({ backups: [], suggestions: [], catalog_reason: null, server_time: new Date().toISOString() });
    if (method === 'GET' && new RegExp(`^/workout-logs/${LOG}/exercises/[^/]+/cue-retry$`).test(path)) return json({ source_version: null, can_create: false, can_recheck: false, outgoing: [], incoming: [] });
    if (path === `/workout-logs/${LOG}/undo` && method === 'GET') {
      const answer = { undo: server.current() };
      const hold = server.holds.get('undo-get');
      if (hold) await hold;
      return json(answer);
    }
    const isWrite = method !== 'GET';
    if (isWrite && server.down) return route.abort('internetdisconnected');
    const body = isWrite ? r.postDataJSON() : null;
    const key = path.split('/').slice(3).join('/').replace(/[0-9a-f-]{36}$/, ':id');
    if (isWrite) server.requests.push({ method, path, body });
    const reply = (value) => ({ ...value, log: clone(server.log), undo: server.current() });
    let answer = null;
    if (method === 'PATCH' && path.startsWith(`/workout-logs/${LOG}/sets/`)) {
      const setId = path.split('/').at(-1);
      const set = server.find(setId);
      const known = server.changes.get(body.event_id);
      if (known) answer = { ...clone(set), event: { id: body.event_id, outcome: 'replayed', original_outcome: 'applied', change: { id: body.event_id, undoable: !known.undone } } };
      else {
        const before = Object.fromEntries(SET_FIELDS.map((k) => [k, set[k]]));
        for (const k of SET_FIELDS) if (k in body) set[k] = body[k];
        set.revision += 1; set.last_actor_role = 'client'; set.value_origin = body.value_origin === 'prefill' ? 'prefill' : 'entered'; set.value_origin_nonce = body.event_id;
        server.record(body.event_id, 'set', body, 'applied', { set: setId, before }, { set_id: setId });
        answer = { ...clone(set), event: { id: body.event_id, outcome: 'applied', change: { id: body.event_id, undoable: true } } };
      }
    } else if (method === 'POST' && /\/exercises\/[^/]+\/done$/.test(path)) {
      const exerciseId = path.split('/').at(-2);
      const known = server.changes.get(body.event_id);
      if (known) answer = reply({ result: { outcome: 'replayed', original_outcome: known.outcome, undone: known.undone, change_id: body.event_id } });
      else {
        server.log.exercises.find((e) => e.id === exerciseId).not_set_tracked = true;
        server.record(body.event_id, 'exercise_done', body, 'applied', { exercise: exerciseId }, { exercise_id: exerciseId });
        answer = reply({ result: { outcome: 'applied', change_id: body.event_id } });
      }
    } else if (method === 'POST' && /\/exercises\/[^/]+\/skip-rest$/.test(path)) {
      const exerciseId = path.split('/').at(-2);
      const known = server.changes.get(body.event_id);
      if (known) answer = reply({ result: { outcome: 'replayed', original_outcome: known.outcome, undone: known.undone } });
      else {
        const sets = body.sets.map((s) => server.find(s.id));
        if (sets.some((s, i) => !s || s.status !== 'pending' || s.revision !== body.sets[i].revision)) {
          server.record(body.event_id, 'exercise_skip', body, 'refused', null, {}, 'A set changed. Check it, then try again.');
          answer = reply({ result: { outcome: 'refused', reason: 'A set changed. Check it, then try again.' } });
        } else {
          sets.forEach((s) => { s.status = 'skipped'; s.revision += 1; });
          server.record(body.event_id, 'exercise_skip', body, 'applied', { skipped: body.sets.map((s) => s.id) }, { exercise_id: exerciseId, set_ids: body.sets.map((s) => s.id) });
          answer = reply({ result: { outcome: 'applied' } });
        }
      }
    } else if (method === 'POST' && path === `/workout-logs/${LOG}/finish`) {
      const known = server.changes.get(body.event_id);
      if (known) answer = reply({ result: { outcome: 'replayed', original_outcome: known.outcome, undone: known.undone, reason: known.reason } });
      else if (server.log.status !== 'active') {
        server.record(body.event_id, 'finish', body, 'refused', null, {}, 'already_completed');
        answer = reply({ result: { outcome: 'refused', reason: 'already_completed' } });
      } else if (body.mode === 'finish' && !server.log.exercises.some((e) => e.sets.some((s) => s.status === 'completed'))) {
        server.record(body.event_id, 'finish', body, 'refused', null, {}, 'complete_at_least_one_set');
        answer = reply({ result: { outcome: 'refused', reason: 'complete_at_least_one_set' } });
      } else {
        server.log.status = 'completed'; server.log.completed_at = new Date().toISOString();
        server.record(body.event_id, 'finish', body, 'applied', { finish: true }, {});
        answer = reply({ result: { outcome: 'applied' } });
      }
    } else if (method === 'POST' && path === `/workout-logs/${LOG}/complete`) {
      // An older page's completion: no event id, no Undo.
      if (server.log.status === 'active') { server.log.status = 'completed'; server.log.completed_at = new Date().toISOString(); }
      return json(clone(server.log));
    } else if (method === 'POST' && path === `/workout-logs/${LOG}/undo`) {
      const known = server.changes.get(body.event_id);
      if (known) answer = reply({ result: { outcome: 'replayed', original_outcome: known.outcome, reason: known.reason } });
      else {
        const target = server.changes.get(body.change_id);
        const current = server.current();
        if (!target || current?.change_id !== body.change_id) {
          server.record(body.event_id, 'undo', body, 'refused', null, {}, 'Something changed since, so this cannot be undone.');
          answer = reply({ result: { outcome: 'refused', reason: 'Something changed since, so this cannot be undone.' } });
        } else {
          const inv = target.inverse;
          if (inv.set) Object.assign(server.find(inv.set), inv.before, { revision: server.find(inv.set).revision + 1 });
          if (inv.exercise) server.log.exercises.find((e) => e.id === inv.exercise).not_set_tracked = false;
          if (inv.skipped) inv.skipped.forEach((id) => { const s = server.find(id); s.status = 'pending'; s.revision += 1; });
          if (inv.finish) { server.log.status = 'active'; server.log.completed_at = null; }
          target.undone = true;
          server.record(body.event_id, 'undo', body, 'applied', null, { undoes: body.change_id });
          answer = reply({ result: { outcome: 'applied', undoes: body.change_id } });
        }
      }
    } else {
      results.unexpected.push(`${method} ${path}`);
      return json({ error: 'Unexpected synthetic route' }, 404);
    }
    const hold = server.holds.get(key);
    if (hold) await hold;
    // The server has it; the reply is lost on the way back.
    if (server.drop.has(key)) return route.abort('connectionreset');
    return json(answer);
  });
  await page.goto(`/client/workouts/${LOG}/track`);
  await expect(page.getByTestId('workout-outline')).toBeVisible();
  return { server, results };
}

const card = (page, name) => page.getByTestId('tracker-exercise-card').filter({ has: page.getByText(name, { exact: true }) }).first();
const reps = (page, name, n) => page.locator(`input[aria-label="${name} set ${n} performed reps"]`);
const settled = (page) => page.waitForFunction((key) => !localStorage.getItem(key), OUTBOX);
const queue = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), OUTBOX);
const undoButton = (page) => page.getByTestId('workout-undo-button');
const held = (server, key) => { let release; server.holds.set(key, new Promise((resolve) => { release = () => { server.holds.delete(key); resolve(); }; })); return () => release(); };
const sent = (server, pattern) => server.requests.filter((request) => pattern.test(request.path));
const setRows = (server, id) => clone(server.log.exercises.find((e) => e.id === id).sets).map((row) => { const copy = { ...row }; delete copy.revision; return copy; });
async function logSet(page, name, n, value) {
  await reps(page, name, n).fill(value);
  await reps(page, name, n).blur();
  await settled(page);
  await card(page, name).getByRole('button', { name: `Complete set ${n}`, exact: true }).click();
  await expect(card(page, name).getByRole('button', { name: `Mark incomplete set ${n}`, exact: true })).toBeVisible();
}
async function finishWorkout(page) {
  await page.getByRole('button', { name: 'Finish workout', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm completion', exact: true }).click();
}

test('a Done reply keeps unsaved typing in another set; set rows stay as they were', async ({ page }) => {
  const { server, results } = await setup(page);
  const rowsBefore = setRows(server, 'a');
  const release = held(server, 'exercises/a/done');
  await card(page, 'Incline Press').getByTestId('exercise-quick-complete').click();
  // Typed while the Done reply is on its way, not blurred.
  await reps(page, 'Goblet Squat', 1).fill('9');
  release();
  await expect.poll(() => server.log.exercises[0].not_set_tracked).toBe(true);
  await expect(card(page, 'Incline Press').getByTestId('exercise-done-chip')).toHaveAttribute('data-mark', 'not_set_tracked');
  await expect(reps(page, 'Goblet Squat', 1)).toHaveValue('9');
  expect(setRows(server, 'a')).toEqual(rowsBefore);
  expect(results.unexpected).toEqual([]);
  expect(results.errors).toEqual([]);
});

test('an Undo reply keeps unsaved typing; Undo targets the newest saved change only', async ({ page }) => {
  const { server, results } = await setup(page);
  const rowsBefore = setRows(server, 'a');
  await card(page, 'Incline Press').getByTestId('exercise-quick-complete').click();
  await settled(page);
  await expect(undoButton(page)).toContainText('Undo Incline Press done');
  const releaseUndo = held(server, 'undo');
  await undoButton(page).click();
  // Typed while the Undo reply is on its way, not blurred.
  await reps(page, 'Goblet Squat', 2).fill('11');
  releaseUndo();
  await expect.poll(() => server.log.exercises[0].not_set_tracked).toBe(false);
  await expect(card(page, 'Incline Press').getByTestId('exercise-quick-complete')).toBeVisible();
  await expect(reps(page, 'Goblet Squat', 2)).toHaveValue('11');
  expect(setRows(server, 'a')).toEqual(rowsBefore);
  expect(results.errors).toEqual([]);
});

test('Done then the next exercise then a logged set then reload never goes back to the done exercise', async ({ page }) => {
  const { server, results } = await setup(page);
  const rowsBefore = setRows(server, 'a');
  await card(page, 'Incline Press').getByTestId('exercise-quick-complete').click();
  await settled(page);
  await logSet(page, 'Goblet Squat', 1, '10');
  await settled(page);
  await page.reload();
  await expect(page.getByTestId('workout-outline')).toBeVisible();
  await expect(card(page, 'Incline Press').getByTestId('exercise-quick-complete')).toHaveCount(0);
  await expect(page.getByTestId('next-set-announcement')).toContainText(/Goblet Squat/);
  expect(setRows(server, 'a')).toEqual(rowsBefore);
  expect(results.errors).toEqual([]);
});

test('Undo before the reply, then a reload with the server unreachable: one Done and one Undo land, in order', async ({ page }) => {
  const { server, results } = await setup(page);
  server.down = true;
  await card(page, 'Incline Press').getByTestId('exercise-quick-complete').click();
  await expect(undoButton(page)).toContainText('Undo Incline Press done');
  await expect(undoButton(page)).toHaveAttribute('data-pending', 'true');
  await undoButton(page).click();
  // Rapid second tap: nothing more is offered or queued.
  await expect(undoButton(page)).toBeDisabled();
  await undoButton(page).click({ force: true });
  expect((await queue(page)).map((op) => op.url.split('/').at(-1))).toEqual(['done', 'undo']);
  await page.reload();
  await expect(page.getByTestId('workout-outline')).toBeVisible();
  expect((await queue(page)).length).toBe(2);
  server.down = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await settled(page);
  const delivered = server.requests.filter((request) => /\/(done|undo)$/.test(request.path));
  expect(delivered.map((request) => request.path.split('/').at(-1)).filter((v, i, all) => all.indexOf(v) === i)).toEqual(['done', 'undo']);
  const done = delivered.find((request) => request.path.endsWith('/done'));
  expect(delivered.filter((request) => request.path.endsWith('/undo')).every((request) => request.body.change_id === done.body.event_id)).toBe(true);
  expect(server.log.exercises[0].not_set_tracked).toBe(false);
  await expect(card(page, 'Incline Press').getByTestId('exercise-quick-complete')).toBeVisible();
  expect(results.errors).toEqual([]);
});

test('a GET of the Undo answered after a newer change does not bring the older Undo back', async ({ page }) => {
  const { server, results } = await setup(page);
  await logSet(page, 'Incline Press', 1, '8');
  await settled(page);
  await expect(undoButton(page)).toContainText('set 1');
  // A read of the server's Undo is held while a newer change is saved.
  const releaseRead = held(server, 'undo-get');
  await page.reload();
  await expect(page.getByTestId('workout-outline')).toBeVisible();
  await card(page, 'Goblet Squat').getByTestId('exercise-quick-complete').click();
  await settled(page);
  await expect(undoButton(page)).toContainText('Undo Goblet Squat done');
  releaseRead();
  await page.waitForTimeout(400);
  await expect(undoButton(page)).toContainText('Undo Goblet Squat done');
  expect(results.errors).toEqual([]);
});

test('skip the rest, then Undo before the reply: the same sets come back, in order on the server', async ({ page }) => {
  const { server, results } = await setup(page);
  await logSet(page, 'Incline Press', 1, '8');
  await settled(page);
  server.down = true;
  await card(page, 'Incline Press').getByTestId('exercise-skip-rest').click();
  await expect(undoButton(page)).toContainText('Undo skip of Incline Press');
  await undoButton(page).click();
  await expect(card(page, 'Incline Press').getByRole('button', { name: 'Complete set 2', exact: true })).toBeVisible();
  server.down = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await settled(page);
  const skip = sent(server, /skip-rest$/).at(-1);
  expect(skip.body.sets.map((s) => s.id)).toEqual(['a-s2', 'a-s3']);
  expect(sent(server, /\/undo$/).at(-1).body.change_id).toBe(skip.body.event_id);
  expect(server.log.exercises[0].sets.map((s) => s.status)).toEqual(['completed', 'pending', 'pending']);
  expect(results.errors).toEqual([]);
});

test('an ordinary Finish goes to the summary exactly once, with Undo finish there', async ({ page }) => {
  const { server, results } = await setup(page);
  await logSet(page, 'Incline Press', 1, '8');
  await settled(page);
  results.navigations.length = 0;
  await finishWorkout(page);
  await expect(page).toHaveURL(new RegExp(`/client/workouts/${LOG}$`));
  await expect(page.getByTestId('detail-undo-finish-button')).toBeVisible();
  await page.waitForTimeout(300);
  // (The summary page clears its one-time state with a same-path replace.)
  const visits = results.navigations.filter((path, at, all) => path !== all[at - 1]);
  expect(visits.filter((path) => path === `/client/workouts/${LOG}`)).toHaveLength(1);
  expect(sent(server, /\/finish$/)).toHaveLength(1);
  // Undo finish reopens the workout and goes back to tracking.
  await page.getByTestId('detail-undo-finish-button').click();
  await expect(page).toHaveURL(new RegExp(`/client/workouts/${LOG}/track$`));
  await expect.poll(() => server.log.status).toBe('active');
  expect(results.errors).toEqual([]);
});

test('a Finish whose reply is lost, undone before the replay: no celebration, the workout reopens', async ({ page }) => {
  const { server, results } = await setup(page);
  await logSet(page, 'Incline Press', 1, '8');
  await settled(page);
  server.drop.add('finish');
  await finishWorkout(page);
  // The page could not confirm it: it is kept on this phone.
  await expect(page).toHaveURL(new RegExp(`/client/workouts/${LOG}$`));
  expect(server.log.status).toBe('completed');
  const finishOp = (await queue(page)).find((op) => op.kind === 'complete');
  expect(finishOp.sent).toBe(true);
  await page.getByTestId('detail-undo-finish-button').click();
  // The connection comes back: the Finish is replayed, then its Undo is sent.
  server.drop.delete('finish');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page).toHaveURL(new RegExp(`/client/workouts/${LOG}/track$`), { timeout: 15_000 });
  expect(server.log.status).toBe('active');
  const undo = sent(server, /\/undo$/).at(-1);
  expect(undo.body.change_id).toBe(finishOp.data.event_id);
  // The Finish was sent again only as a replay of the same event.
  expect(new Set(sent(server, /\/finish$/).map((request) => request.body.event_id)).size).toBe(1);
  await expect(page.getByText('Workout complete')).toHaveCount(0);
  expect(results.errors).toEqual([]);
});

test('a Finish that never left the phone is taken back with nothing sent', async ({ page }) => {
  const { server, results } = await setup(page);
  await logSet(page, 'Incline Press', 1, '8');
  await settled(page);
  await page.context().setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await finishWorkout(page);
  await expect(page).toHaveURL(new RegExp(`/client/workouts/${LOG}$`));
  await page.getByTestId('detail-undo-finish-button').click();
  await expect(page).toHaveURL(new RegExp(`/client/workouts/${LOG}/track$`));
  await page.context().setOffline(false);
  expect(sent(server, /\/(finish|undo)$/)).toHaveLength(0);
  expect((await queue(page)).filter((op) => op.kind === 'complete')).toHaveLength(0);
  expect(server.log.status).toBe('active');
  expect(results.errors).toEqual([]);
});

test('a refused Finish keeps the earlier valid Undo', async ({ page }) => {
  const { server, results } = await setup(page);
  await card(page, 'Incline Press').getByTestId('exercise-quick-complete').click();
  await settled(page);
  await expect(undoButton(page)).toContainText('Undo Incline Press done');
  // Another device logs nothing; this Finish is refused (mode 'finish' with no completed set is forced here).
  await page.route(`**/api/workout-logs/${LOG}/finish`, async (route) => {
    const body = route.request().postDataJSON();
    await route.fallback({ postData: JSON.stringify({ ...body, mode: 'finish' }) });
  });
  await finishWorkout(page);
  await expect(page.getByText('Complete at least one set')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/client/workouts/${LOG}/track$`));
  await expect(undoButton(page)).toContainText('Undo Incline Press done');
  expect(server.log.status).toBe('active');
  expect(results.errors).toEqual([]);
});

// Two tabs share one saved queue (LOOK-A-FINISH-CANCEL-REVIEW). Tab B is kept
// offline by its own navigator.onLine so it never sends; tab A sends the shared
// Finish with its reply held. B's Undo must not claim a cancel from its stale memory.
async function seedFinishQueue(page, op) {
  await page.evaluate(([key, value]) => localStorage.setItem(key, JSON.stringify([value])), [OUTBOX, op]);
}
const finishQueued = (eventId) => ({
  id: 'q-finish', attempts: 0, kind: 'complete', method: 'post', url: `/workout-logs/${LOG}/finish`,
  data: { event_id: eventId, mode: 'finish', notes: '', feedback: '', completed_at_local: new Date().toISOString() },
});
async function offlineTab(context) {
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__online = window.localStorage.getItem('test_tab_b_online') === 'yes';
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => window.__online });
  });
  await page.goto(`/client/workouts/${LOG}/track`);
  await expect(page.getByTestId('workout-outline')).toBeVisible();
  return page;
}

for (const reloadB of [false, true]) {
  test(`two tabs: B undoes a Finish A is sending (reply held${reloadB ? ', B reloads offline' : ''}); the Undo wins, once`, async ({ page }) => {
    const { server, results } = await setup(page);
    await logSet(page, 'Incline Press', 1, '8');
    await settled(page);
    const eventId = '7f6a2c4e-1b3d-4e5f-8a9b-0c1d2e3f4a5b';
    // Tab B opens on a queue holding an unsent Finish, and stays offline.
    await page.evaluate(() => localStorage.setItem('test_tab_b_online', 'no'));
    await seedFinishQueue(page, finishQueued(eventId));
    const tabB = await offlineTab(page.context(), server);
    await expect(tabB.getByTestId('workout-undo-button')).toContainText('Undo finish');
    // Tab A (reloaded on the same queue) sends the Finish; the reply is held.
    const release = held(server, 'finish');
    await page.reload();
    await expect.poll(() => sent(server, /\/finish$/).length).toBe(1);
    // B decides from storage under the shared lock: the Finish was sent, so an Undo is queued behind it.
    await tabB.getByTestId('workout-undo-button').click();
    await expect.poll(() => tabB.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]').some((op) => op.undoOf?.kind === 'finish'), OUTBOX)).toBe(true);
    await expect(tabB.getByText('Finish taken back')).toHaveCount(0);
    if (reloadB) {
      await tabB.reload();
      // The server has the Finish by now: B opens on the summary, the Undo still queued.
      await expect(tabB.getByTestId('workout-completion-summary')).toBeVisible();
      await expect.poll(() => tabB.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]').some((op) => op.undoOf?.kind === 'finish'), OUTBOX)).toBe(true);
    }
    release();
    // A finishes delivery, sees the Undo behind it, sends it, and shows no completion.
    await expect.poll(() => server.log.status, { timeout: 15_000 }).toBe('active');
    await expect(page).toHaveURL(new RegExp(`/client/workouts/${LOG}/track$`));
    await expect(page.getByText('Workout complete')).toHaveCount(0);
    // B comes online: its copies replay; nothing changes twice.
    await tabB.evaluate(() => { window.__online = true; window.dispatchEvent(new Event('online')); });
    await expect.poll(() => tabB.evaluate((key) => localStorage.getItem(key), OUTBOX), { timeout: 15_000 }).toBe(null);
    expect(new Set(sent(server, /\/finish$/).map((r) => r.body.event_id))).toEqual(new Set([eventId]));
    const undos = sent(server, /\/undo$/);
    expect(new Set(undos.map((r) => r.body.event_id)).size).toBe(1);
    expect(undos.every((r) => r.body.change_id === eventId)).toBe(true);
    expect([...server.changes.values()].filter((c) => c.kind === 'undo' && c.outcome === 'applied')).toHaveLength(1);
    expect(server.log.status).toBe('active');
    await expect(tabB).toHaveURL(new RegExp(`/client/workouts/${LOG}/track$`));
    expect(results.errors).toEqual([]);
  });
}

// LOOK-A-QUEUE-ATOMICITY-REVIEW closure: A sends the Finish and its reply has
// already removed it from storage before offline B, still holding the unsent
// copy in memory and its own journal, chooses Undo. B must not rebuild "never
// sent" from its journal; only storage counts, so it queues an ordered Undo.
test('two tabs: A\'s Finish is delivered and cleared before offline B undoes it; B queues an Undo, never a cancel', async ({ page }) => {
  const { server, results } = await setup(page);
  await logSet(page, 'Incline Press', 1, '8');
  await settled(page);
  const eventId = '3c9e1a7b-5d2f-4b6a-9c8e-1f0a2b3c4d5e';
  await page.evaluate(() => localStorage.setItem('test_tab_b_online', 'no'));
  await seedFinishQueue(page, finishQueued(eventId));
  const tabB = await offlineTab(page.context(), server);
  await expect(tabB.getByTestId('workout-undo-button')).toContainText('Undo finish');
  // A sends the Finish and its reply removes it from storage.
  await page.reload();
  await expect.poll(() => server.log.status, { timeout: 15_000 }).toBe('completed');
  await expect.poll(() => queue(page)).toEqual([]);
  // B, offline and unaware, undoes the Finish.
  await tabB.getByTestId('workout-undo-button').click();
  await expect.poll(() => queue(tabB).then((ops) => ops.map((op) => op.undoOf?.kind ?? op.kind))).toEqual(['finish']);
  await expect(tabB.getByText('Finish taken back')).toHaveCount(0);
  // The storage copy holds the Undo only; B's journal did not resurrect the Finish.
  expect((await queue(tabB)).some((op) => op.kind === 'complete')).toBe(false);
  // B comes online: the Undo applies exactly once and the workout reopens.
  await tabB.evaluate(() => { window.__online = true; window.dispatchEvent(new Event('online')); });
  await expect.poll(() => tabB.evaluate((key) => localStorage.getItem(key), OUTBOX), { timeout: 15_000 }).toBe(null);
  expect(new Set(sent(server, /\/finish$/).map((r) => r.body.event_id))).toEqual(new Set([eventId]));
  const undos = sent(server, /\/undo$/);
  expect(undos.length).toBeGreaterThan(0);
  expect(undos.every((r) => r.body.change_id === eventId)).toBe(true);
  expect([...server.changes.values()].filter((c) => c.kind === 'undo' && c.outcome === 'applied')).toHaveLength(1);
  expect(server.log.status).toBe('active');
  await expect(tabB).toHaveURL(new RegExp(`/client/workouts/${LOG}/track$`));
  expect(results.errors).toEqual([]);
});

test('an older queued completion with no event id that was already tried is never "cancelled"', async ({ page }) => {
  const { server, results } = await setup(page);
  await logSet(page, 'Incline Press', 1, '8');
  await settled(page);
  await page.evaluate(() => localStorage.setItem('test_tab_b_online', 'no'));
  await seedFinishQueue(page, { id: 'q-legacy', attempts: 1, kind: 'complete', method: 'post', url: `/workout-logs/${LOG}/complete`, data: { notes: '' } });
  const tabB = await offlineTab(page.context(), server);
  // No Undo is offered for it (there is no change id to undo, and no proof it never left).
  await expect(tabB.getByTestId('workout-undo')).toHaveCount(0);
  // (Sealed by that queued completion: the dock offers no Undo at all.)
  expect((await queue(tabB)).map((op) => op.id)).toEqual(['q-legacy']);
  await tabB.evaluate(() => { window.__online = true; window.dispatchEvent(new Event('online')); });
  await expect(tabB).toHaveURL(new RegExp(`/client/workouts/${LOG}$`), { timeout: 15_000 });
  expect(sent(server, /\/complete$/)).toHaveLength(1);
  expect(server.log.status).toBe('completed');
  await expect(tabB.getByTestId('detail-undo-finish-button')).toHaveCount(0);
  expect(results.errors).toEqual([]);
});

// LOOK-A-QUEUE-ATOMICITY-REVIEW: tab A is paused after reading the shared queue
// and before writing it; tab B writes meanwhile. Coordination must order the
// two writes so neither change is lost, including after a reload.
test('a paused read-then-write in one tab never loses the other tab\'s queued change', async ({ page }) => {
  const { server, results } = await setup(page);
  await page.evaluate(() => localStorage.setItem('test_tab_b_online', 'no'));
  const tabA = await offlineTab(page.context(), server);
  const tabB = await offlineTab(page.context(), server);
  await tabA.evaluate(() => {
    window.__pause = new Promise((resolve) => { window.__release = resolve; });
    window.__cvfQueueWriteHook = async () => { window.__cvfQueueWriteHook = null; window.__paused = true; await window.__pause; };
  });
  // A: a set write is queued; its storage write reads, then pauses.
  await reps(tabA, 'Incline Press', 1).fill('7');
  await reps(tabA, 'Incline Press', 1).blur();
  await expect.poll(() => tabA.evaluate(() => window.__paused === true)).toBe(true);
  // B: Done (and its Undo) are queued while A holds the queue.
  await card(tabB, 'Goblet Squat').getByTestId('exercise-quick-complete').click();
  await tabB.getByTestId('workout-undo-button').click();
  await tabB.waitForTimeout(300);
  await tabA.evaluate(() => window.__release());
  const stored = () => tabA.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]').map((op) => op.url.split('/').slice(-2).join('/')), OUTBOX);
  await expect.poll(stored).toEqual(['sets/a-s1', 'b/done', `${LOG}/undo`]);
  for (const tab of [tabA, tabB]) {
    await tab.reload();
    await expect(tab.getByTestId('workout-outline')).toBeVisible();
  }
  await expect.poll(stored).toEqual(['sets/a-s1', 'b/done', `${LOG}/undo`]);
  // Nothing was sent while both were offline.
  expect(server.requests).toHaveLength(0);
  expect(results.errors).toEqual([]);
});
