// PR120 review 4366537633: a contract set write (event_id) whose database RPC
// fails must stay inside the PATCH route's error boundary — a controlled 500
// and one logged error — exactly like a failing legacy write. Real Express
// router on a loopback server; Supabase, auth and the logger are stubbed via
// the require cache.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { canAccessClient } = require('../src/security/access');

const EVENT = '11111111-1111-4111-8111-111111111111';
let log, exercise, set, rpcMode, rpcCalls, writes, logged, unhandled;
function reset() {
  log = { id: 'log-a', client_id: 'client-a', status: 'active', archived: false, client: { id: 'client-a', coach_id: 'coach-a', archived: false } };
  exercise = { id: 'ex-a', workout_log_id: 'log-a', tracking_type: 'reps_weight', archived: false };
  set = { id: 'set-a', workout_log_exercise_id: 'ex-a', status: 'pending', revision: 0, actual_load_value: 35, actual_load_unit: 'lb', actual_reps: null, actual_rpe: null, actual_duration_value: null, actual_duration_unit: null, actual_distance_value: null, actual_distance_unit: null, archived: false };
  rpcMode = 'error'; rpcCalls = []; writes = []; logged = []; unhandled = [];
}
process.on('unhandledRejection', (reason) => { unhandled.push(String(reason?.message || reason)); });

const dbPath = require.resolve('../src/supabase');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { supabaseAdmin: {
  rpc(name, args) {
    rpcCalls.push({ name, args });
    if (name !== 'apply_workout_set_event') return Promise.resolve({ data: null, error: null });
    if (rpcMode === 'error') return Promise.resolve({ data: null, error: { message: 'synthetic RPC failure', code: 'XX000' } });
    if (rpcMode === 'reject') return Promise.reject(new Error('synthetic transport rejection'));
    return Promise.resolve({ data: { outcome: 'applied', set: { ...set, ...args.p_payload, revision: 1 } }, error: null });
  },
  from(table) {
    const filters = []; let payload;
    const rows = () => (table === 'workout_logs' ? [log] : table === 'workout_log_exercises' ? [exercise] : table === 'workout_log_sets' ? [set] : []).filter((row) => filters.every(([key, value]) => row[key] === value));
    const chain = { select() { return chain; }, eq(key, value) { filters.push([key, value]); return chain; }, in() { return chain; }, order() { return chain; },
      update(value) { payload = value; return chain; }, maybeSingle() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
      single() { const row = rows()[0]; if (payload) { if (rpcMode === 'legacy-error') return Promise.resolve({ data: null, error: { message: 'synthetic legacy failure' } }); writes.push(payload); Object.assign(row, payload); } return Promise.resolve({ data: row, error: null }); },
      then(resolve) { return resolve({ data: rows(), count: 0, error: null }); } };
    return chain;
  },
} } };
const authPath = require.resolve('../src/middleware/auth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  requireAuth(req, _res, next) { req.user = { role: 'client', client: { id: 'client-a' } }; next(); },
  requireCoach(_req, res) { res.status(403).json({ error: 'Coach access required' }); }, requireClient(_req, _res, next) { next(); }, canAccessClient,
} };
const loggerPath = require.resolve('../src/utils/logger');
require.cache[loggerPath] = { id: loggerPath, filename: loggerPath, loaded: true, exports: { logError(context, error) { logged.push({ context, message: error?.message }); } } };

const app = express(); app.use(express.json()); app.use('/api/workout-logs', require('../src/routes/workoutLogs'));
let server, base;
test.before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => new Promise((resolve) => server.close(resolve)));

async function patch(body) {
  try {
    const res = await fetch(`${base}/api/workout-logs/log-a/sets/set-a`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(1500) });
    return { status: res.status, body: await res.json() };
  } catch (error) {
    return { status: 'no-response', body: String(error.name) };
  }
}
const contract = { event_id: EVENT, base_revision: 0, status: 'completed', actual_reps: 8, actual_load_value: 35, actual_load_unit: 'lb' };

for (const mode of ['error', 'reject']) {
  test(`contract set write: a ${mode === 'error' ? 'returned RPC error' : 'rejected RPC promise'} is a controlled 500 that is logged`, async () => {
    reset(); rpcMode = mode;
    const response = await patch(contract);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual({ status: response.status, body: response.body }, { status: 500, body: { error: 'Failed to save set' } });
    assert.equal(rpcCalls.filter((call) => call.name === 'apply_workout_set_event').length, 1);
    assert.deepEqual(logged.map((row) => row.context), ['update workout set error']);
    assert.deepEqual(unhandled, []);
    assert.equal(writes.length, 0, 'no legacy write on the contract path');
  });
}

test('contract set write still succeeds, and the legacy path keeps its own error handling', async () => {
  reset(); rpcMode = 'ok';
  const ok = await patch(contract);
  assert.equal(ok.status, 200); assert.equal(ok.body.event.outcome, 'applied'); assert.equal(ok.body.event.id, EVENT);
  assert.deepEqual(logged, []);
  reset(); rpcMode = 'legacy-error';
  const legacy = await patch({ status: 'completed', actual_reps: 8, actual_load_value: 35, actual_load_unit: 'lb' });
  assert.deepEqual({ status: legacy.status, body: legacy.body }, { status: 500, body: { error: 'Failed to save set' } });
  assert.deepEqual(logged.map((row) => row.context), ['update workout set error']);
  assert.equal(rpcCalls.filter((call) => call.name === 'apply_workout_set_event').length, 0);
});

// PR120 review 4366537636 (backend side): the participant conductor's typed
// metric payloads (as sent by the repaired coach set row) pass the real route
// validation and reach the event RPC; the old reps-only shape stays a 400.
test('contract set write accepts the participant conductor metric payloads and refuses reps on metric types', async () => {
  const cases = [
    ['duration', { actual_reps: null, actual_load_value: null, actual_load_unit: null, actual_duration_value: 50, actual_duration_unit: 's' }],
    ['distance', { actual_reps: null, actual_load_value: 40, actual_load_unit: 'kg', actual_distance_value: 25, actual_distance_unit: 'm' }],
    ['duration_distance', { actual_reps: null, actual_load_value: null, actual_load_unit: null, actual_duration_value: 12.5, actual_duration_unit: 'min', actual_distance_value: 2, actual_distance_unit: 'mi' }],
  ];
  for (const [type, fields] of cases) {
    reset(); rpcMode = 'ok'; exercise.tracking_type = type; set.actual_load_value = null; set.actual_load_unit = null;
    const ok = await patch({ event_id: EVENT, base_revision: 0, status: 'completed', ...fields });
    assert.equal(ok.status, 200, `${type}: ${JSON.stringify(ok.body)}`);
    const sent = rpcCalls.find((call) => call.name === 'apply_workout_set_event').args.p_payload;
    for (const [key, value] of Object.entries(fields)) assert.equal(sent[key], value, `${type} ${key}`);
    reset(); rpcMode = 'ok'; exercise.tracking_type = type; set.actual_load_value = null; set.actual_load_unit = null;
    const old = await patch({ event_id: EVENT, base_revision: 0, status: 'completed', actual_reps: 8, actual_load_value: 25, actual_load_unit: 'lb' });
    assert.equal(old.status, 400, `${type}: the pre-repair reps-only shape is refused`);
    assert.equal(rpcCalls.filter((call) => call.name === 'apply_workout_set_event').length, 0);
  }
});
