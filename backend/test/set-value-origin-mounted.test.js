// Set value origin (cross-device Undo, local migration 20261113000000): the
// PATCH set route forwards a declared origin to apply_workout_set_event_v2,
// keeps undeclared writes on the unchanged v1 RPC, falls back to v1 when the
// database has no v2 (old schema), and the coach plan edit propagates the new
// prescription only to untouched sets under a fresh nonce, falling back to the
// old revision-0 filter when the column is missing. Real Express router on a
// loopback server; Supabase, auth and the logger are stubbed via the require
// cache (same pattern as set-event-error-boundary-mounted.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { canAccessClient } = require('../src/security/access');

const EVENT = '22222222-2222-4222-8222-222222222222';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let log, exercise, set, role, rpcMode, rpcCalls, updates, setUpdateMode, logged;
function reset() {
  log = { id: 'log-a', client_id: 'client-a', status: 'active', archived: false, client: { id: 'client-a', coach_id: 'coach-a', archived: false } };
  exercise = { id: 'ex-a', workout_log_id: 'log-a', tracking_type: 'reps_weight', archived: false, plan_revision: 0, prescribed_load_value: 50, prescribed_load_unit: 'lb' };
  set = { id: 'set-a', workout_log_exercise_id: 'ex-a', status: 'pending', revision: 1, actual_load_value: null, actual_load_unit: null, actual_reps: null, actual_rpe: null, actual_duration_value: null, actual_duration_unit: null, actual_distance_value: null, actual_distance_unit: null, archived: false, value_origin: 'entered' };
  role = 'client'; rpcMode = 'ok'; rpcCalls = []; updates = []; setUpdateMode = 'ok'; logged = [];
}

const dbPath = require.resolve('../src/supabase');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { supabaseAdmin: {
  rpc(name, args) {
    rpcCalls.push({ name, args });
    if (name === 'apply_workout_set_event_v2' && rpcMode === 'no-v2') return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.apply_workout_set_event_v2' } });
    if (name === 'apply_workout_set_event_v2' && rpcMode === 'no-v2-sql') return Promise.resolve({ data: null, error: { code: '42883', message: 'function public.apply_workout_set_event_v2 does not exist' } });
    if (name === 'apply_workout_set_event_v2' && rpcMode === 'v2-error') return Promise.resolve({ data: null, error: { code: 'XX000', message: 'synthetic v2 failure' } });
    if (name !== 'apply_workout_set_event' && name !== 'apply_workout_set_event_v2') return Promise.resolve({ data: null, error: null });
    const origin = name === 'apply_workout_set_event_v2' ? args.p_value_origin : 'unknown';
    return Promise.resolve({ data: { outcome: 'applied', set: { ...set, ...args.p_payload, revision: set.revision + 1, value_origin: origin } }, error: null });
  },
  from(table) {
    const filters = []; const ors = []; let payload;
    const rows = () => (table === 'workout_logs' ? [log] : table === 'workout_log_exercises' ? [exercise] : table === 'workout_log_sets' ? [set] : []).filter((row) => filters.every(([key, value]) => row[key] === value));
    const finish = () => {
      if (!payload) return { data: rows(), count: 0, error: null };
      const record = { table, payload, filters: [...filters], ors: [...ors] };
      updates.push(record);
      if (table === 'workout_log_sets' && setUpdateMode !== 'ok' && ('value_origin' in payload || ors.length)) {
        return { data: null, error: setUpdateMode === 'missing-column-filter'
          ? { code: '42703', message: 'column workout_log_sets.value_origin does not exist' }
          : { code: 'PGRST204', message: "Could not find the 'value_origin' column of 'workout_log_sets' in the schema cache" } };
      }
      return { data: rows().map((row) => Object.assign(row, table === 'workout_log_sets' ? {} : payload)), error: null };
    };
    const chain = { select() { return chain; }, eq(key, value) { filters.push([key, value]); return chain; }, or(value) { ors.push(value); return chain; },
      in() { return chain; }, order() { return chain; }, update(value) { payload = value; return chain; },
      maybeSingle() { const r = finish(); return Promise.resolve({ data: Array.isArray(r.data) ? r.data[0] || null : r.data, error: r.error }); },
      single() { const r = finish(); return Promise.resolve({ data: Array.isArray(r.data) ? r.data[0] || null : r.data, error: r.error }); },
      then(resolve, reject) { return Promise.resolve(finish()).then(resolve, reject); } };
    return chain;
  },
} } };
const authPath = require.resolve('../src/middleware/auth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  requireAuth(req, _res, next) {
    req.user = role === 'coach' ? { role: 'coach', coach: { id: 'coach-a' } } : { role: 'client', client: { id: 'client-a' } };
    next();
  },
  requireCoach(req, res, next) { if (req.user.role === 'coach') return next(); return res.status(403).json({ error: 'Coach access required' }); },
  requireClient(_req, _res, next) { next(); }, canAccessClient,
} };
const loggerPath = require.resolve('../src/utils/logger');
require.cache[loggerPath] = { id: loggerPath, filename: loggerPath, loaded: true, exports: { logError(context, error) { logged.push({ context, message: error?.message }); } } };

const app = express(); app.use(express.json()); app.use('/api/workout-logs', require('../src/routes/workoutLogs'));
let server, base;
test.before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => new Promise((resolve) => server.close(resolve)));

async function call(method, path, body) {
  const res = await fetch(`${base}/api/workout-logs/log-a${path}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(1500) });
  return { status: res.status, body: await res.json() };
}
const undo = { event_id: EVENT, base_revision: 1, status: 'pending', actual_load_value: 50, actual_load_unit: 'lb', actual_reps: null };
const names = () => rpcCalls.map((row) => row.name).filter((name) => name.startsWith('apply_workout_set_event'));

for (const origin of ['prefill', 'entered']) {
  test(`a declared '${origin}' write goes to v2 with that origin and returns it`, async () => {
    reset();
    const response = await call('PATCH', '/sets/set-a', { ...undo, value_origin: origin });
    assert.equal(response.status, 200);
    assert.deepEqual(names(), ['apply_workout_set_event_v2']);
    const args = rpcCalls.find((row) => row.name === 'apply_workout_set_event_v2').args;
    assert.equal(args.p_value_origin, origin);
    assert.equal(args.p_event_id, EVENT);
    assert.equal('value_origin' in args.p_payload, false, 'origin is not a set value');
    assert.equal(response.body.value_origin, origin);
    assert.equal(response.body.event.outcome, 'applied');
  });
}

test('an undeclared contract write stays on the unchanged v1 RPC (exactly one call)', async () => {
  reset();
  const response = await call('PATCH', '/sets/set-a', undo);
  assert.equal(response.status, 200);
  assert.deepEqual(names(), ['apply_workout_set_event']);
  assert.equal('p_value_origin' in rpcCalls[0].args, false);
});

for (const bad of ['unknown', 'legacy', 'PREFILL', 3, true, '']) {
  test(`value_origin ${JSON.stringify(bad)} is refused with 400 and nothing is written`, async () => {
    reset();
    const response = await call('PATCH', '/sets/set-a', { ...undo, value_origin: bad });
    assert.equal(response.status, 400);
    assert.match(response.body.error, /value_origin/);
    assert.deepEqual(names(), []);
  });
}

for (const mode of ['no-v2', 'no-v2-sql']) {
  test(`old database without v2 (${mode}): the write falls back to v1 once, without the declaration`, async () => {
    reset(); rpcMode = mode;
    const response = await call('PATCH', '/sets/set-a', { ...undo, value_origin: 'prefill' });
    assert.equal(response.status, 200);
    assert.deepEqual(names(), ['apply_workout_set_event_v2', 'apply_workout_set_event']);
    assert.equal('p_value_origin' in rpcCalls[1].args, false);
    assert.equal(rpcCalls[1].args.p_event_id, EVENT, 'same event id, so replay stays idempotent');
    assert.deepEqual(logged, []);
  });
}

test('any other v2 failure is not retried on v1 and stays a controlled, logged 500', async () => {
  reset(); rpcMode = 'v2-error';
  const response = await call('PATCH', '/sets/set-a', { ...undo, value_origin: 'entered' });
  assert.equal(response.status, 500);
  assert.deepEqual(names(), ['apply_workout_set_event_v2']);
  assert.deepEqual(logged.map((row) => row.context), ['update workout set error']);
});

const planEdit = { event_id: EVENT, base_plan_revision: 0, prescribed_load_value: 60, prescribed_load_unit: 'lb' };
test('plan edit propagates only to untouched sets, marked prefill under a fresh nonce', async () => {
  reset(); role = 'coach';
  const response = await call('PATCH', '/exercises/ex-a/plan', planEdit);
  assert.equal(response.status, 200);
  const setWrites = updates.filter((row) => row.table === 'workout_log_sets');
  assert.equal(setWrites.length, 1);
  const [write] = setWrites;
  assert.equal(write.payload.actual_load_value, 60);
  assert.equal(write.payload.actual_load_unit, 'lb');
  assert.equal(write.payload.value_origin, 'prefill');
  assert.match(write.payload.value_origin_nonce, UUID_RE);
  assert.deepEqual(write.filters, [['workout_log_exercise_id', 'ex-a'], ['status', 'pending'], ['archived', false]]);
  assert.deepEqual(write.ors, ['value_origin.eq.prefill,and(value_origin.eq.legacy,revision.eq.0,last_actor_role.is.null)']);
});

for (const mode of ['missing-column', 'missing-column-filter']) {
  test(`plan edit on an old database (${mode}) falls back to the revision-0 filter without origin fields`, async () => {
    reset(); role = 'coach'; setUpdateMode = mode;
    const response = await call('PATCH', '/exercises/ex-a/plan', planEdit);
    assert.equal(response.status, 200);
    const setWrites = updates.filter((row) => row.table === 'workout_log_sets');
    assert.equal(setWrites.length, 2);
    assert.equal('value_origin' in setWrites[1].payload, false);
    assert.equal('value_origin_nonce' in setWrites[1].payload, false);
    assert.deepEqual(setWrites[1].ors, []);
    assert.deepEqual(setWrites[1].filters, [['workout_log_exercise_id', 'ex-a'], ['status', 'pending'], ['revision', 0], ['archived', false]]);
    assert.deepEqual(logged, []);
  });
}
