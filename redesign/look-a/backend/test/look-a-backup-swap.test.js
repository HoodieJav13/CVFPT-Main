// Integration review 4 (LOOK-A-INTEGRATION-REVIEW.md): a coach backup swap
// keeps the backup's saved replacement facts. The current client sends them;
// an older client (queued before Look A) omits the upper load and per side and
// always labelled the load "lb". The server recovers only what the client
// could not express, never overwrites an explicit adjustment, and never
// relabels a kg backup as lb. Real Express router on a loopback server;
// Supabase and auth stubbed via the require cache.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { canAccessClient } = require('../src/security/access');
const { backupTargets, normalizeTargets } = require('../src/lib/sessionEvents');

const SAVED = { target_sets: 3, target_reps: '8', target_load_value: 30, target_load_unit: 'kg', target_load_max: 35, target_per_side: true };

test('rule: the current payload is kept as sent', () => {
  const raw = { sets: 3, reps: '8', load_value: 30, load_unit: 'kg', load_max: 35, per_side: true };
  assert.deepEqual(backupTargets(SAVED, normalizeTargets(raw), raw), { sets: 3, reps: '8', load_value: 30, load_unit: 'kg', load_max: 35, per_side: true });
});

test('rule: an old payload recovers the saved range, per side and kg', () => {
  const raw = { sets: 3, reps: '8', load_value: 30, load_unit: 'lb' };
  assert.deepEqual(backupTargets(SAVED, normalizeTargets(raw), raw), { sets: 3, reps: '8', load_value: 30, load_unit: 'kg', load_max: 35, per_side: true });
});

test('rule: an adjusted load is a single number in the backup unit, per side kept', () => {
  const raw = { sets: 3, reps: '8', load_value: 40, load_unit: 'lb' };
  assert.deepEqual(backupTargets(SAVED, normalizeTargets(raw), raw), { sets: 3, reps: '8', load_value: 40, load_unit: 'kg', per_side: true });
});

test('rule: explicit choices win over saved facts', () => {
  const raw = { sets: 2, load_value: 30, load_unit: 'kg', load_max: null, per_side: false };
  assert.deepEqual(backupTargets(SAVED, normalizeTargets(raw), raw), { sets: 2, load_value: 30, load_unit: 'kg' });
});

test('rule: a backup without a load keeps the client load (lb default) and invents nothing', () => {
  const saved = { target_sets: null, target_reps: null, target_load_value: null, target_load_unit: null, target_load_max: null, target_per_side: false };
  const raw = { load_value: 20 };
  assert.deepEqual(backupTargets(saved, normalizeTargets(raw), raw), { load_value: 20, load_unit: 'lb' });
  assert.deepEqual(backupTargets(saved, normalizeTargets({}), {}), {});
});

// ---------- mounted route ----------
const LOG = 'log-a';
const ORIGINAL = 'ex-a';
const BACKUP = '33333333-3333-4333-8333-333333333333';
const LIB = '44444444-4444-4444-8444-444444444444';
let rpcCalls;
const backupRow = { id: BACKUP, workout_exercise_id: 'wex-a', backup_exercise_library_id: LIB, archived: false, ...SAVED };
const tables = {
  workout_logs: [{ id: LOG, client_id: 'client-a', status: 'active', archived: false, client: { id: 'client-a', coach_id: 'coach-a', archived: false } }],
  workout_log_exercises: [{ id: ORIGINAL, workout_log_id: LOG, archived: false, position: 0, exercise_library_id: 'lib-original', source_workout_exercise_id: 'wex-a', exercise_name: 'Fictional Split Squat' }],
  exercise_library: [{ id: LIB, name: 'Fictional Step Up', review_status: 'approved', hidden: false, archived: false }],
  workout_exercise_backups: [backupRow],
};
const dbPath = require.resolve('../src/supabase');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { supabaseAdmin: {
  rpc(name, args) {
    rpcCalls.push({ name, args });
    if (name === 'create_workout_substitution') return Promise.resolve({ data: { outcome: 'created', substitution: { id: args.p_row.id, targets: args.p_row.targets } }, error: null });
    return Promise.resolve({ data: null, error: null });
  },
  from(table) {
    const filters = [];
    const rows = () => (tables[table] || []).filter((row) => filters.every(([key, value]) => row[key] === value));
    const chain = { select() { return chain; }, eq(key, value) { filters.push([key, value]); return chain; }, in() { return chain; }, order() { return chain; },
      is() { return chain; }, limit() { return chain; }, update() { return chain; }, insert() { return chain; }, upsert() { return chain; },
      maybeSingle() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
      single() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
      then(resolve) { return resolve({ data: rows(), count: 0, error: null }); } };
    return chain;
  },
} } };
const authPath = require.resolve('../src/middleware/auth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  requireAuth(req, _res, next) { req.user = { role: 'client', client: { id: 'client-a' } }; next(); },
  requireCoach(_req, res) { res.status(403).json({ error: 'Coach access required' }); },
  requireClient(_req, _res, next) { next(); }, canAccessClient,
} };
const app = express(); app.use(express.json()); app.use('/api/workout-logs', require('../src/routes/workoutLogs'));
let server, base;
test.before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => new Promise((resolve) => server.close(resolve)));
async function swap(targets) {
  rpcCalls = [];
  const res = await fetch(`${base}/api/workout-logs/${LOG}/exercises/${ORIGINAL}/substitutions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    id: '55555555-5555-4555-8555-555555555555', replacement_log_exercise_id: '66666666-6666-4666-8666-666666666666',
    source: 'coach_backup', backup_id: BACKUP, exercise_library_id: LIB, trigger: 'equipment_busy', targets, offline: false, create_target_sets: false,
  }) });
  const call = rpcCalls.find((c) => c.name === 'create_workout_substitution');
  return { status: res.status, targets: call?.args.p_row.targets };
}

test('mounted: an old queued backup swap keeps the saved range, per side and kg', async () => {
  const r = await swap({ sets: 3, reps: '8', load_value: 30, load_unit: 'lb' });
  assert.equal(r.status < 300, true, `status ${r.status}`);
  assert.deepEqual(r.targets, { sets: 3, reps: '8', load_value: 30, load_unit: 'kg', load_max: 35, per_side: true });
});

test('mounted: the current payload with an adjusted load stays a single number', async () => {
  const r = await swap({ sets: 3, reps: '8', load_value: 32.5, load_unit: 'kg', per_side: true });
  assert.deepEqual(r.targets, { sets: 3, reps: '8', load_value: 32.5, load_unit: 'kg', per_side: true });
});
