// Shared stateful synthetic server for the adapted Look A browser specs
// (LOOK-A-BROWSER-CONTRACT-MAP + LOOK-A-TEST-ADAPTATION-ADDENDUM, 2026-11-15).
// Same rules as the reviewed copy in workout-ux-look-a-lifecycle.spec.mjs: an
// event id is the change id and replays its first answer; Undo inverts only
// the newest applied change and only while nothing material changed since;
// a coach prescription change ends the current inverse; refused changes leave
// it alone. Fictional data only. Proves page behaviour and the requests sent,
// not the database rules (supabase/tests/look_a covers those).
import { expect } from '@playwright/test';

export const SET_FIELDS = ['status', 'actual_load_value', 'actual_load_unit', 'actual_reps', 'actual_rpe'];
export const clone = (value) => JSON.parse(JSON.stringify(value));
const material = (log) => JSON.stringify([log.status, log.exercises.map((e) => [e.id, e.not_set_tracked, e.prescription_seq || 0, e.sets.map((s) => [s.id, ...SET_FIELDS.map((k) => s[k])])])]);

export function makeServer(log) {
  const server = {
    log, changes: new Map(), order: [], requests: [], holds: new Map(), drop: new Set(), down: false, reject: new Map(), tick: 0,
  };
  server.find = (setId) => server.log.exercises.flatMap((e) => e.sets).find((s) => s.id === setId);
  server.stamp = () => new Date(Date.UTC(2026, 10, 14, 12, 0, server.tick++)).toISOString();
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
  // A coach changes an exercise's prescription (another device): a material
  // change of its own with no client inverse.
  server.coachPrescription = (exerciseId, fields) => {
    const exercise = server.log.exercises.find((e) => e.id === exerciseId);
    Object.assign(exercise, fields, { plan_revision: (exercise.plan_revision || 0) + 1, prescription_seq: (exercise.prescription_seq || 0) + 1 });
    server.record(`coach-${server.tick}`, 'prescription', fields, 'applied', null);
  };
  // A coach saves values on a set from another device: newer input, no client inverse.
  server.coachSet = (setId, fields) => {
    const set = server.find(setId);
    Object.assign(set, fields, { revision: set.revision + 1, last_actor_role: 'coach', value_origin: 'entered', value_origin_nonce: `coach-${server.tick}`, updated_at: server.stamp() });
    server.record(`coach-set-${server.tick}`, 'coach_set', fields, 'applied', null);
  };
  return server;
}

// oldServer: rows carry NO provenance columns (value_origin, its nonce and the
// prefill snapshot are removed from every read and reply, and a declared
// origin is ignored). This fixture mode removes those columns only; it is not
// a whole old-server API compatibility test or proof of actor authorization.
const ORIGIN_KEYS = ['value_origin', 'value_origin_nonce', 'prefill_load_value', 'prefill_load_unit'];
export async function installServer(page, server, { logId, profile = 'Fictional client', legacySetReplies = false, oldServer = false } = {}) {
  const strip = (set) => { const copy = clone(set); if (oldServer) for (const key of ORIGIN_KEYS) delete copy[key]; return copy; };
  const visibleLog = () => ({ ...clone(server.log), exercises: server.log.exercises.map((e) => ({ ...clone(e), sets: e.sets.map(strip) })) });
  const results = { errors: [], unexpected: [], writes: [] };
  page.on('pageerror', (error) => results.errors.push(error.message));
  await page.context().addInitScript(() => localStorage.setItem('cvf_access_token', 'synthetic-look-a-token'));
  await page.context().route('**/api/**', async (route) => {
    const r = route.request();
    const path = new URL(r.url()).pathname.replace(/^\/api/, '');
    const method = r.method();
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/auth/me') return json({ role: 'client', email: 'look-a@example.invalid', profile: { id: server.log.client_id, name: profile, waiver_signed: true } });
    if (path === '/telemetry/events') return route.fulfill({ status: 204 });
    if (path.endsWith('/unread-count')) return json({ unread: 0 });
    if (path === `/workout-logs/${logId}` && method === 'GET') {
      const readHold = server.holds.get('log-get');
      if (readHold) await readHold;
      return json({ ...visibleLog(), server_time: new Date().toISOString() });
    }
    if (new RegExp(`^/workout-logs/${logId}/exercises/[^/]+/history$`).test(path)) return json({ occurrences: [], next_cursor: null });
    if (new RegExp(`^/workout-logs/${logId}/exercises/[^/]+/substitution-options$`).test(path)) return json({ backups: [], suggestions: [], catalog_reason: null, server_time: new Date().toISOString() });
    if (method === 'GET' && new RegExp(`^/workout-logs/${logId}/exercises/[^/]+/cue-retry$`).test(path)) return json({ source_version: null, can_create: false, can_recheck: false, outgoing: [], incoming: [] });
    if (path === `/workout-logs/${logId}/undo` && method === 'GET') {
      const answer = { undo: server.current() };
      const hold = server.holds.get('undo-get');
      if (hold) await hold;
      return json(answer);
    }
    const isWrite = method !== 'GET';
    if (isWrite && server.down) return route.abort('internetdisconnected');
    const body = isWrite ? r.postDataJSON() : null;
    const key = path.split('/').slice(3).join('/');
    if (isWrite) server.requests.push({ method, path, body });
    const reply = (value) => ({ ...value, log: visibleLog(), undo: server.current() });
    let answer = null;
    if (method === 'PATCH' && path.startsWith(`/workout-logs/${logId}/sets/`)) {
      const setId = path.split('/').at(-1);
      const set = server.find(setId);
      results.writes.push({ setId, ...Object.fromEntries(SET_FIELDS.filter((k) => k in body).map((k) => [k, body[k]])), event_id: body.event_id, base_revision: body.base_revision });
      const rejection = server.reject.get(setId);
      if (rejection) return json({ error: rejection }, 422);
      // A write without an event id (an old page): applied as is, no replay protection, no inverse.
      if (!body.event_id) {
        for (const k of SET_FIELDS) if (k in body) set[k] = body[k];
        Object.assign(set, { value_origin: 'unknown', updated_at: server.stamp() });
        return json({ ...strip(set) });
      }
      const known = server.changes.get(body.event_id);
      const special = !known && server.setHook ? server.setHook(set, body) : null;
      const same = !known && !special && SET_FIELDS.every((k) => !(k in body) || body[k] === set[k]);
      if (known) answer = { ...strip(set), event: { id: body.event_id, outcome: 'replayed', original_outcome: known.outcome, ...(legacySetReplies || !known.inverse ? {} : { change: { id: body.event_id, undoable: !known.undone } }) } };
      else if (special) {
        // Another writer got there first (the hook changed the row); nothing of this write is applied.
        server.record(body.event_id, 'set', body, special.outcome, null);
        answer = { ...strip(set), event: { id: body.event_id, outcome: special.outcome, ...(special.conflict_id ? { conflict_id: special.conflict_id } : {}), change: null } };
      } else if (same) {
        // Nothing material changed: nothing is recorded and the current Undo stands.
        server.changes.set(body.event_id, { kind: 'set', outcome: 'applied', inverse: null, undone: false });
        answer = { ...strip(set), event: { id: body.event_id, outcome: 'applied', change: null } };
      } else {
        const before = Object.fromEntries([...SET_FIELDS, 'value_origin', 'value_origin_nonce'].map((k) => [k, set[k]]));
        for (const k of SET_FIELDS) if (k in body) set[k] = body[k];
        Object.assign(set, { revision: set.revision + 1, last_actor_role: 'client', value_origin: oldServer ? 'unknown' : body.value_origin === 'prefill' ? 'prefill' : 'entered', value_origin_nonce: body.event_id, updated_at: server.stamp() });
        server.record(body.event_id, 'set', body, 'applied', { set: setId, before }, { set_id: setId });
        answer = { ...strip(set), event: { id: body.event_id, outcome: 'applied', ...(legacySetReplies ? {} : { change: { id: body.event_id, undoable: true } }) } };
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
    } else if (method === 'POST' && path === `/workout-logs/${logId}/finish`) {
      const known = server.changes.get(body.event_id);
      if (known) answer = reply({ result: { outcome: 'replayed', original_outcome: known.outcome, undone: known.undone, reason: known.reason } });
      else if (server.log.status !== 'active') {
        server.record(body.event_id, 'finish', body, 'refused', null, {}, 'already_completed');
        answer = reply({ result: { outcome: 'refused', reason: 'already_completed' } });
      } else {
        server.log.status = 'completed'; server.log.completed_at = new Date().toISOString();
        server.record(body.event_id, 'finish', body, 'applied', { finish: true }, {});
        answer = reply({ result: { outcome: 'applied' } });
      }
    } else if (method === 'POST' && path === `/workout-logs/${logId}/undo`) {
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
          if (inv.set) { const s = server.find(inv.set); Object.assign(s, inv.before, { revision: s.revision + 1, updated_at: server.stamp() }); }
          if (inv.exercise) server.log.exercises.find((e) => e.id === inv.exercise).not_set_tracked = false;
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
    if (server.drop.has(key)) return route.abort('connectionreset');
    try { return await json(answer); } catch { return undefined; /* the page that sent it has reloaded */ }
  });
  return results;
}

export const held = (server, key) => { let release; server.holds.set(key, new Promise((resolve) => { release = () => { server.holds.delete(key); resolve(); }; })); return () => release(); };
export const sent = (server, pattern) => server.requests.filter((request) => pattern.test(request.path));
export const card = (page, name) => page.getByTestId('tracker-exercise-card').filter({ has: page.getByText(name, { exact: true }) }).first();
export const reps = (page, name, n) => page.locator(`input[aria-label="${name} set ${n} performed reps"]`);
export const settled = (page, logId) => page.waitForFunction((key) => !localStorage.getItem(key), `cvf_workout_outbox_${logId}`);
export const undoButton = (page) => page.getByTestId('workout-undo-button');
export async function open(page, logId) {
  await page.goto(`/client/workouts/${logId}/track`);
  await expect(page.getByTestId('workout-outline')).toBeVisible();
}
