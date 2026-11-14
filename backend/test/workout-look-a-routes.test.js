// Look A routes mounted on the real workout-log router (local, 2026-11-14):
// exercise done, skip the rest, the one Undo, Finish with a mode, current
// Undo. Supabase, auth and push are stubbed through the require cache; the
// database decides outcomes (supabase/tests/look_a/), so this checks the HTTP
// contract: access masking, input validation, actor from auth (never body),
// error mapping, reply shape, and push only when the call created the notice.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const CLIENT_ID = 'cccccccc-0000-4000-8000-00000000000c';
const OTHER_CLIENT = 'cccccccc-0000-4000-8000-00000000000d';
const COACH_ID = 'aaaaaaaa-0000-4000-8000-00000000000a';
const OTHER_COACH = 'aaaaaaaa-0000-4000-8000-00000000000b';
const LOG_ID = 'eeeeeeee-0000-4000-8000-00000000000e';
const EX_ID = 'ffffffff-0000-4000-8000-00000000000f';
const SET_ID = 'dddddddd-0000-4000-8000-00000000000d';
const EVENT = '9a9a9a9a-0000-4000-8000-000000000001';
const TARGET = '9a9a9a9a-0000-4000-8000-000000000002';

const state = {};
function reset() {
  state.rpc = [];
  state.pushes = 0;
  state.rpcResult = {};
  state.rpcError = {};
  state.log = { id: LOG_ID, client_id: CLIENT_ID, coach_id: COACH_ID, status: 'active', archived: false, workout_name: 'Fictional A',
    client: { id: CLIENT_ID, name: 'Fictional Jo', archived: false, coach_id: COACH_ID } };
}
reset();

function chainFor(table) {
  const filters = {};
  const chain = {
    select() { return chain; }, eq(k, v) { filters[k] = v; return chain; }, is() { return chain; }, or() { return chain; },
    order() { return chain; }, limit() { return chain; }, in() { return chain; }, not() { return chain; }, gte() { return chain; },
    update() { return chain; }, upsert() { return Promise.resolve({ data: [], error: null }); }, insert() { return chain; },
    maybeSingle() {
      if (table === 'workout_logs') return Promise.resolve({ data: filters.id === state.log.id ? state.log : null, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    single() { return chain.maybeSingle(); },
    then(resolve, reject) {
      let data = [];
      if (table === 'workout_log_exercises') data = [{ id: EX_ID, workout_log_id: LOG_ID, exercise_name: 'Fictional Squat', position: 0 }];
      if (table === 'workout_log_sets') data = [{ id: SET_ID, workout_log_exercise_id: EX_ID, set_number: 1, status: 'pending', revision: 0 }];
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    },
  };
  return chain;
}
const supabasePath = require.resolve('../src/supabase');
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: { supabaseAdmin: {
  from: chainFor,
  rpc(name, args) {
    state.rpc.push({ name, args });
    if (state.rpcError[name]) return Promise.resolve({ data: null, error: state.rpcError[name] });
    if (name in state.rpcResult) return Promise.resolve({ data: state.rpcResult[name], error: null });
    if (name === 'workout_current_undo') return Promise.resolve({ data: { change_id: EVENT, kind: 'exercise_done' }, error: null });
    return Promise.resolve({ data: { outcome: 'applied', change_id: args.p_event_id, undoable: true }, error: null });
  },
} } };
const pushPath = require.resolve('../src/services/push');
require.cache[pushPath] = { id: pushPath, filename: pushPath, loaded: true, exports: {
  dispatchPush: () => { state.pushes += 1; }, sendToCoaches: async () => {}, sendToClient: async () => {}, dispatch: () => {},
} };
let currentUser;
const authPath = require.resolve('../src/middleware/auth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  requireAuth: (req, _res, next) => { req.user = currentUser; next(); },
  requireCoach: (req, res, next) => (['coach', 'admin'].includes(req.user?.role) ? next() : res.status(403).json({ error: 'Coach access required' })),
  requireClient: (req, res, next) => (req.user?.role === 'client' ? next() : res.status(403).json({ error: 'Client access required' })),
  canAccessClient: (user, client) => user?.role === 'admin' || user?.coach?.id === client?.coach_id,
} };

const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/workout-logs', require('../src/routes/workoutLogs'));
const server = http.createServer(app);
let base;
test.before(async () => { await new Promise((r) => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());

async function call(method, path, body) {
  const res = await fetch(`${base}/api/workout-logs${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const asClient = (id = CLIENT_ID) => { currentUser = { role: 'client', client: { id, coach_id: COACH_ID } }; };
const asCoach = (id = COACH_ID) => { currentUser = { role: 'coach', coach: { id } }; };
const lookACalls = () => state.rpc.filter((c) => !['workout_current_undo'].includes(c.name));

test('another client and an unrelated coach get 404 and nothing runs', async () => {
  for (const who of [() => asClient(OTHER_CLIENT), () => asCoach(OTHER_COACH)]) {
    reset(); who();
    const results = await Promise.all([
      call('GET', `/${LOG_ID}/undo`),
      call('POST', `/${LOG_ID}/exercises/${EX_ID}/done`, { event_id: EVENT }),
      call('POST', `/${LOG_ID}/exercises/${EX_ID}/skip-rest`, { event_id: EVENT, sets: [{ id: SET_ID, revision: 0 }] }),
      call('POST', `/${LOG_ID}/undo`, { event_id: EVENT, change_id: TARGET }),
      call('POST', `/${LOG_ID}/finish`, { event_id: EVENT, mode: 'finish' }),
    ]);
    assert.deepEqual(results.map((r) => r.status), [404, 404, 404, 404, 404]);
    assert.ok(results.every((r) => r.body.error === 'Workout log not found'), 'same masked answer as a missing log');
    assert.equal(state.rpc.length, 0, 'no database function called');
  }
});

test('invalid ids and inputs are refused before any database call', async () => {
  reset(); asClient();
  const cases = [
    ['POST', `/${LOG_ID}/exercises/${EX_ID}/done`, {}],
    ['POST', `/${LOG_ID}/exercises/${EX_ID}/done`, { event_id: 'nope' }],
    ['POST', `/${LOG_ID}/exercises/${EX_ID}/skip-rest`, { event_id: EVENT, sets: [] }],
    ['POST', `/${LOG_ID}/exercises/${EX_ID}/skip-rest`, { event_id: EVENT, sets: [{ id: SET_ID, revision: -1 }] }],
    ['POST', `/${LOG_ID}/exercises/${EX_ID}/skip-rest`, { event_id: EVENT, sets: [{ id: 'x', revision: 0 }] }],
    ['POST', `/${LOG_ID}/undo`, { event_id: EVENT }],
    ['POST', `/${LOG_ID}/undo`, { event_id: EVENT, change_id: 'x' }],
    ['POST', `/${LOG_ID}/finish`, { event_id: EVENT }],
    ['POST', `/${LOG_ID}/finish`, { event_id: EVENT, mode: 'home_quick' }],
  ];
  for (const [m, p, b] of cases) assert.equal((await call(m, p, b)).status, 400, `${p} ${JSON.stringify(b)}`);
  assert.equal(state.rpc.length, 0);
  const missing = await call('POST', `/${LOG_ID}/exercises/ffffffff-0000-4000-8000-000000000999/done`, { event_id: EVENT });
  assert.equal(missing.status, 404, 'an exercise of another workout');
  assert.equal(lookACalls().length, 0);
});

test('exercise done: actor from auth, ids lower-cased, reply carries log and current Undo', async () => {
  reset(); asCoach();
  const r = await call('POST', `/${LOG_ID}/exercises/${EX_ID}/done`, { event_id: EVENT.toUpperCase(), actor_role: 'client', p_actor_role: 'client' });
  assert.equal(r.status, 200);
  const done = state.rpc.find((c) => c.name === 'mark_workout_exercise_not_set_tracked').args;
  assert.deepEqual(done, { p_log_id: LOG_ID, p_exercise_id: EX_ID, p_event_id: EVENT, p_actor_role: 'coach', p_actor_coach_id: COACH_ID });
  assert.equal(r.body.result.outcome, 'applied');
  assert.equal(r.body.log.id, LOG_ID);
  assert.deepEqual(r.body.undo, { change_id: EVENT, kind: 'exercise_done' });
  const undoArgs = state.rpc.find((c) => c.name === 'workout_current_undo').args;
  assert.deepEqual(undoArgs, { p_log_id: LOG_ID, p_actor_role: 'coach', p_actor_coach_id: COACH_ID }, 'current Undo is for this actor');
});

test('skip the rest forwards exactly the sets seen', async () => {
  reset(); asClient();
  const r = await call('POST', `/${LOG_ID}/exercises/${EX_ID}/skip-rest`, { event_id: EVENT, sets: [{ id: SET_ID.toUpperCase(), revision: 3 }] });
  assert.equal(r.status, 200);
  const args = state.rpc.find((c) => c.name === 'skip_workout_exercise_sets').args;
  assert.deepEqual(args.p_sets, [{ id: SET_ID, revision: 3 }]);
  assert.equal(args.p_actor_role, 'client'); assert.equal(args.p_actor_coach_id, null);
});

test('undo passes the target; a refusal is a 200 with the reason, not an error', async () => {
  reset(); asClient();
  state.rpcResult.undo_workout_material_change = { outcome: 'refused', reason: 'A later change replaced this Undo.' };
  state.rpcResult.workout_current_undo = null;
  const r = await call('POST', `/${LOG_ID}/undo`, { event_id: EVENT, change_id: TARGET });
  assert.equal(r.status, 200);
  assert.equal(state.rpc.find((c) => c.name === 'undo_workout_material_change').args.p_target_id, TARGET);
  assert.equal(r.body.result.reason, 'A later change replaced this Undo.');
  assert.equal(r.body.undo, null);
});

test('GET undo reports the current Undo, or null before the migration', async () => {
  reset(); asClient();
  assert.deepEqual((await call('GET', `/${LOG_ID}/undo`)).body, { undo: { change_id: EVENT, kind: 'exercise_done' } });
  state.rpcError.workout_current_undo = { code: 'PGRST202', message: 'missing' };
  const r = await call('GET', `/${LOG_ID}/undo`);
  assert.equal(r.status, 200); assert.equal(r.body.undo, null);
});

test('finish: push only when this call created the notice', async () => {
  reset(); asClient();
  state.rpcResult.finish_workout_log_v3 = { outcome: 'applied', notified: true };
  let r = await call('POST', `/${LOG_ID}/finish`, { event_id: EVENT, mode: 'not_set_tracked', completed_at_local: '2026-11-14T10:00:00Z' });
  assert.equal(r.status, 200); assert.equal(state.pushes, 1);
  const args = state.rpc.find((c) => c.name === 'finish_workout_log_v3').args;
  assert.equal(args.p_mode, 'not_set_tracked'); assert.equal(args.p_completed_at, '2026-11-14T10:00:00.000Z');
  assert.equal(args.p_client_id, CLIENT_ID, 'the log owner, never a body value');
  for (const result of [{ outcome: 'applied', notified: false }, { outcome: 'replayed', notified: false, original_outcome: 'applied' }, { outcome: 'refused', reason: 'already_completed' }]) {
    reset(); asClient();
    state.rpcResult.finish_workout_log_v3 = result;
    r = await call('POST', `/${LOG_ID}/finish`, { event_id: EVENT, mode: 'finish' });
    assert.equal(r.status, 200); assert.equal(state.pushes, 0, JSON.stringify(result));
  }
  reset(); asClient();
  state.rpcResult.finish_workout_log_v3 = { outcome: 'refused', reason: 'complete_at_least_one_set' };
  r = await call('POST', `/${LOG_ID}/finish`, { event_id: EVENT, mode: 'finish', completed_at_local: 'not a date' });
  assert.equal(r.status, 400); assert.equal(state.pushes, 0);
  assert.equal(state.rpc.find((c) => c.name === 'finish_workout_log_v3').args.p_completed_at, null, 'an unreadable time is not sent');
});

test('database errors map to 409/503/404 without SQL details', async () => {
  const cases = [
    [{ message: 'event_id_reused' }, 409],
    [{ code: 'PGRST202', message: 'Could not find the function public.mark_workout_exercise_not_set_tracked' }, 503],
    [{ message: 'Workout exercise not found' }, 404],
    [{ message: 'Workout log is not active' }, 409],
    [{ message: 'internal detail: relation x' }, 500],
  ];
  for (const [error, status] of cases) {
    reset(); asClient();
    state.rpcError.mark_workout_exercise_not_set_tracked = error;
    const r = await call('POST', `/${LOG_ID}/exercises/${EX_ID}/done`, { event_id: EVENT });
    assert.equal(r.status, status, error.message);
    assert.ok(!/relation|function public/.test(r.body.error), r.body.error);
  }
});
