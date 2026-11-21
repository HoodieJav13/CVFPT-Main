// Duplicate-tab queue drain (LOOK-A-INTEGRATION-REVIEW.md case 1, 2026-11-14).
// Two tabs of one browser load the same saved queue of two writes (A, B) for
// one set. Tab 1 delivers both. Tab 2 then replays A (answered "replayed"),
// re-checks B against the server's current row and rebuilds it on the newer
// revision, keeping B's event id. The server binds an event id to the exact
// request it first saw (apply_workout_set_event_v3), so the rebuilt B is
// refused (409) although the original B is already saved. The page must
// resend B's exact original request, which the server answers "replayed",
// instead of dropping it as a rejected write.
//
// Normal mode, synthetic in-process API (binding rule mirrored from
// supabase/migrations/20261114120000 set-v3). Fictional data only. This
// proves the page's queue behaviour, not the database rule itself
// (supabase/tests/look_a covers that).
import { test, expect } from '@playwright/test';

const LOG = 'dd-log';
const FIELDS = ['status', 'actual_load_value', 'actual_load_unit', 'actual_reps', 'actual_rpe'];
const row = (n, extra = {}) => ({
  id: `a-s${n}`, workout_log_exercise_id: 'a', set_number: n, status: 'pending', set_origin: 'prescribed',
  actual_load_value: 50, actual_load_unit: 'lb', actual_reps: null, actual_rpe: null,
  actual_duration_value: null, actual_duration_unit: null, actual_distance_value: null, actual_distance_unit: null,
  revision: 0, last_actor_role: null, value_origin: 'legacy', value_origin_nonce: null, prefill_load_value: null, prefill_load_unit: null, ...extra,
});
function serverCopy() {
  return {
    log: {
      id: LOG, client_id: 'dd-client', workout_name: 'Fictional two-tab workout', status: 'active', started_at: new Date().toISOString(),
      exercises: [{
        id: 'a', exercise_name: 'Incline Press', tracking_type: 'reps_weight', prescribed_sets: '3', prescribed_reps: '8', prescribed_load_value: 50, prescribed_load_unit: 'lb', prescribed_rest_seconds: 90, superset_group: null, plan_revision: 0, backups: [],
        sets: [row(1), row(2), row(3)],
      }],
      coach_responses: [], conflicts: [], substitutions: [],
    },
    blocked: new Set(['A', 'B']), events: new Map(), replies: [],
  };
}
const findSet = (server, id) => server.log.exercises.flatMap((exercise) => exercise.sets).find((set) => set.id === id);
// What a set-v3 event is bound to: the set, the base it was built on and the
// values (not transport details).
const fingerprint = (setId, body) => JSON.stringify([setId, body.base_revision ?? null, body.plan_revision_seen ?? null, body.value_origin ?? null,
  ...FIELDS.map((key) => (key in body ? body[key] : '~'))]);

async function tab(context, server, label) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/**', async (route) => {
    const r = route.request();
    const path = new URL(r.url()).pathname.replace(/^\/api/, '');
    const method = r.method();
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (path === '/auth/me') return json({ role: 'client', email: 'dd@example.invalid', profile: { id: 'dd-client', name: 'Fictional two-tab client', waiver_signed: true } });
    if (path === '/telemetry/events') return route.fulfill({ status: 204 });
    if (path.endsWith('/unread-count')) return json({ unread: 0 });
    if (path === `/workout-logs/${LOG}` && method === 'GET') return json({ ...server.log, server_time: new Date().toISOString() });
    if (path === `/workout-logs/${LOG}/undo` && method === 'GET') return json({ undo: null });
    if (new RegExp(`^/workout-logs/${LOG}/exercises/[^/]+/history$`).test(path)) return json({ occurrences: [], next_cursor: null });
    if (new RegExp(`^/workout-logs/${LOG}/exercises/[^/]+/substitution-options$`).test(path)) return json({ backups: [], suggestions: [], catalog_reason: null, server_time: new Date().toISOString() });
    if (method === 'GET' && new RegExp(`^/workout-logs/${LOG}/exercises/[^/]+/cue-retry$`).test(path)) return json({ source_version: null, can_create: false, can_recheck: false, outgoing: [], incoming: [] });
    if (method === 'PATCH' && path.startsWith(`/workout-logs/${LOG}/sets/`)) {
      if (server.blocked.has(label)) return json({ error: 'Synthetic outage' }, 503);
      const setId = path.split('/').at(-1);
      const set = findSet(server, setId);
      const body = r.postDataJSON();
      const print = fingerprint(setId, body);
      const known = server.events.get(body.event_id);
      const note = (status, outcome) => server.replies.push({ tab: label, event: body.event_id, status, outcome, base: body.base_revision, reps: body.actual_reps });
      if (known && known.print !== print) {
        note(409, 'event_id_reused');
        return json({ error: 'That event id belongs to another set' }, 409);
      }
      if (known) { note(200, 'replayed'); return json({ ...set, event: { outcome: 'replayed', original_outcome: 'applied' } }); }
      for (const key of FIELDS) if (key in body) set[key] = body[key];
      Object.assign(set, { revision: set.revision + 1, last_actor_role: 'client', value_origin: body.value_origin === 'entered' ? 'entered' : 'unknown', value_origin_nonce: body.event_id });
      server.events.set(body.event_id, { print });
      note(200, 'applied');
      return json({ ...set, event: { outcome: 'applied', change: null } });
    }
    return json({ error: `Unexpected synthetic route ${method} ${path}` }, 404);
  });
  await page.goto(`/client/workouts/${LOG}/track`);
  await expect(page.getByTestId('workout-outline')).toBeVisible();
  return { page, errors };
}
const repsInput = (page, n) => page.locator(`input[aria-label="Incline Press set ${n} performed reps"]`);
const online = (page) => page.evaluate(() => window.dispatchEvent(new Event('online')));

test('a write already saved by another tab is answered as saved, not dropped', async ({ browser }) => {
  const server = serverCopy();
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => localStorage.setItem('cvf_access_token', 'synthetic-dd-token'));
  const one = await tab(context, server, 'A');
  // Two writes for set 2 are queued while the server is unreachable.
  await repsInput(one.page, 2).fill('7');
  await repsInput(one.page, 2).blur();
  await repsInput(one.page, 2).fill('9');
  await repsInput(one.page, 2).blur();
  await expect.poll(() => one.page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]').filter((op) => op.kind === 'set').length, `cvf_workout_outbox_${LOG}`)).toBe(2);
  // A second tab opens on the same saved queue.
  const two = await tab(context, server, 'B');
  // Tab 1 delivers both writes.
  server.blocked.delete('A');
  await online(one.page);
  await expect.poll(() => server.replies.filter((r) => r.tab === 'A' && r.outcome === 'applied').length).toBe(2);
  const [eventA, eventB] = server.replies.filter((r) => r.tab === 'A').map((r) => r.event);
  // Tab 2 drains its copy of the same queue.
  server.blocked.delete('B');
  await online(two.page);
  // The exchange is printed for the evidence log whatever the result.
  const print = () => console.log('REPLIES', JSON.stringify(server.replies.map(({ tab: t, outcome, status, base, reps }) => [t, outcome, status, base, reps])));
  const timer = setTimeout(print, 4500);
  await expect.poll(() => server.replies.filter((r) => r.tab === 'B' && r.event === eventB && r.status === 200).map((r) => r.outcome)).toEqual(['replayed']);
  expect(server.replies.filter((r) => r.tab === 'B' && r.event === eventA).map((r) => r.outcome)).toEqual(['replayed']);
  // Saved exactly once; tab 2 shows no rejection and keeps nothing as undelivered.
  expect(findSet(server, 'a-s2')).toMatchObject({ actual_reps: 9, revision: 2 });
  await expect(two.page.getByTestId('workout-save-state')).toContainText('Saved');
  await expect(two.page.getByText('That event id belongs to another set')).toHaveCount(0);
  const kept = await two.page.evaluate(() => Object.keys(localStorage).filter((key) => /undelivered|outbox/.test(key) && localStorage.getItem(key) && localStorage.getItem(key) !== '[]'));
  expect(kept).toEqual([]);
  await expect(repsInput(two.page, 2)).toHaveValue('9');
  expect([...one.errors, ...two.errors]).toEqual([]);
  clearTimeout(timer); print();
  await context.close();
});
