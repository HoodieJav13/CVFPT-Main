// Look A swap route (20261114170000; LOOK-A-HANDOFF-REVIEW.md 1-3 and
// LOOK-A-SWAP-RACE-REVIEW.md 1-3). A swap sent with expected_sets goes through
// create_workout_substitution_v3 every time, including a retry of a swap
// already recorded, so the database's request check and recorded answer
// decide it; the old by-id early replay is kept only for older queued
// payloads. Refusals (changed count, missing backup count) are 409 with the
// explanation; a busy workout is a retryable 503. A late Add Set under an
// archived exercise is a 409, and a coach decision on a swap the client took
// back says so. Real Express router on a loopback server; Supabase and auth
// stubbed via the require cache. Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { canAccessClient } = require('../src/security/access');

const LOG = 'log-a';
const ORIGINAL = 'ex-a';
const BACKUP = '33333333-3333-4333-8333-333333333333';
const LIB = '44444444-4444-4444-8444-444444444444';
const SWAP = '55555555-5555-4555-8555-555555555555';
const REP = '66666666-6666-4666-8666-666666666666';
const SET_IDS = ['77777777-7777-4777-8777-777777777771', '77777777-7777-4777-8777-777777777772'];
let rpcCalls;
let rpcReply;
let insertError;
let user;
let tables;
function reset() {
  rpcCalls = []; insertError = null; user = { role: 'client', client: { id: 'client-a' } };
  rpcReply = () => ({ data: { outcome: 'created', sets: 2, undoable: true, substitution: { id: SWAP, status: 'active' } }, error: null });
  tables = {
    workout_logs: [{ id: LOG, client_id: 'client-a', status: 'active', archived: false, client: { id: 'client-a', coach_id: 'coach-a', archived: false } }],
    workout_log_exercises: [{ id: ORIGINAL, workout_log_id: LOG, archived: false, position: 0, exercise_library_id: 'lib-original', source_workout_exercise_id: 'wex-a', exercise_name: 'Fictional Split Squat' }],
    workout_log_sets: [],
    exercise_library: [{ id: LIB, name: 'Fictional Step Up', review_status: 'approved', hidden: false, archived: false }],
    workout_exercise_backups: [{ id: BACKUP, workout_exercise_id: 'wex-a', backup_exercise_library_id: LIB, archived: false, target_sets: 3, target_reps: '8', target_load_value: 30, target_load_unit: 'kg', target_load_max: 35, target_per_side: true }],
    workout_log_substitutions: [],
    workout_material_changes: [],
  };
}
reset();
const dbPath = require.resolve('../src/supabase');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { supabaseAdmin: {
  rpc(name, args) {
    rpcCalls.push({ name, args });
    if (name === 'create_workout_substitution_v3') return Promise.resolve(rpcReply(args));
    if (name === 'create_workout_substitution') return Promise.resolve({ data: { outcome: 'created', substitution: { id: args.p_row.id } }, error: null });
    if (name === 'decide_workout_substitution') return Promise.resolve({ data: { outcome: 'already_decided', substitution: { id: SWAP, status: 'undone' } }, error: null });
    if (name === 'workout_current_undo') return Promise.resolve({ data: { change_id: SWAP, kind: 'swap' }, error: null });
    return Promise.resolve({ data: null, error: null });
  },
  from(table) {
    const filters = [];
    let inserting = false;
    const rows = () => (tables[table] || []).filter((row) => filters.every(([key, value]) => row[key] === value));
    const chain = { select() { return chain; }, eq(key, value) { filters.push([key, value]); return chain; }, in() { return chain; }, order() { return chain; },
      is() { return chain; }, limit() { return chain; }, update() { return chain; }, insert() { inserting = true; return chain; }, upsert() { return chain; },
      maybeSingle() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
      single() { return Promise.resolve(inserting && insertError ? { data: null, error: insertError } : { data: rows()[0] || null, error: null }); },
      then(resolve) { return resolve({ data: rows(), count: 0, error: null }); } };
    return chain;
  },
} } };
const authPath = require.resolve('../src/middleware/auth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  requireAuth(req, _res, next) { req.user = user; next(); },
  requireCoach(req, res, next) { if (req.user.role === 'coach') return next(); return res.status(403).json({ error: 'Coach access required' }); },
  requireClient(_req, _res, next) { next(); }, canAccessClient,
} };
const app = express(); app.use(express.json()); app.use('/api/workout-logs', require('../src/routes/workoutLogs'));
let server, base;
test.before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => new Promise((resolve) => server.close(resolve)));
test.beforeEach(reset);

const lookABody = (extra = {}) => ({ id: SWAP, replacement_log_exercise_id: REP, source: 'coach_backup', backup_id: BACKUP, exercise_library_id: LIB,
  trigger: 'other', targets: { reps: '8', load_value: 30, load_unit: 'kg', load_max: 35, per_side: true }, offline: false,
  expected_sets: 2, set_ids: SET_IDS, ...extra });
async function post(body, path = `/api/workout-logs/${LOG}/exercises/${ORIGINAL}/substitutions`) {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
const names = () => rpcCalls.map((c) => c.name);

test('a Look A swap goes to v3 with the shown count, the page set ids and the client intent', async () => {
  const r = await post(lookABody());
  assert.equal(r.status, 201);
  const call = rpcCalls.find((c) => c.name === 'create_workout_substitution_v3');
  assert.ok(call, `calls ${names()}`);
  assert.equal(names().includes('create_workout_substitution'), false);
  assert.equal(call.args.p_expected_sets, 2);
  assert.deepEqual(call.args.p_set_ids, SET_IDS);
  assert.equal(call.args.p_activate, true);
  assert.equal(call.args.p_row.trigger, 'other');
  assert.equal(call.args.p_row.reason, null);
  assert.deepEqual(call.args.p_row.client_targets, { reps: '8', load_value: 30, load_unit: 'kg', load_max: 35, per_side: true });
  assert.equal('sets' in call.args.p_row.targets, false, 'the page never sends a typed count for a backup');
  assert.deepEqual(r.body.change, { id: SWAP, undoable: true });
  assert.equal(r.body.undo.kind, 'swap');
});

test('a retry of a recorded swap is answered by v3, never by id alone', async () => {
  tables.workout_log_substitutions = [{ id: SWAP, workout_log_id: LOG, status: 'active' }];
  rpcReply = () => ({ data: null, error: { message: 'event_id_reused' } });
  const r = await post(lookABody({ trigger: 'cannot_do' }));
  assert.equal(r.status, 409);
  assert.match(r.body.error, /already used/);
  assert.deepEqual(names().filter((n) => n.startsWith('create_')), ['create_workout_substitution_v3']);
  // The same retry, matching: the recorded answer.
  rpcReply = () => ({ data: { outcome: 'replayed', original_outcome: 'applied', sets: 2, undoable: true, substitution: { id: SWAP, status: 'active' } }, error: null });
  const again = await post(lookABody());
  assert.equal(again.status, 200);
  assert.equal(again.body.outcome, 'replayed');
});

test('a recorded refusal (no swap row) also replays through v3', async () => {
  tables.workout_material_changes = [{ id: SWAP, workout_log_id: LOG }];
  rpcReply = () => ({ data: { outcome: 'replayed', original_outcome: 'refused', reason: 'count_changed', sets: 1, message: 'This workout changed, so the backup now has 1 set. Check and swap again.' }, error: null });
  const r = await post(lookABody());
  assert.equal(r.status, 409);
  assert.equal(r.body.reason, 'count_changed');
  assert.equal(r.body.sets, 1);
});

test("another workout's swap id is never returned", async () => {
  tables.workout_log_substitutions = [{ id: SWAP, workout_log_id: 'log-other', status: 'active' }];
  const r = await post(lookABody());
  assert.equal(r.status, 404);
  assert.deepEqual(names(), []);
});

test('a changed count and a backup without its own count are refused with the explanation', async () => {
  rpcReply = () => ({ data: { outcome: 'refused', reason: 'count_changed', sets: 1, message: 'This workout changed, so the backup now has 1 set. Check and swap again.' }, error: null });
  let r = await post(lookABody());
  assert.equal(r.status, 409);
  assert.deepEqual([r.body.reason, r.body.sets], ['count_changed', 1]);
  rpcReply = () => ({ data: { outcome: 'refused', reason: 'missing_prescription', message: 'Your coach has not set how many sets this backup has, so it was not swapped in. Ask your coach, or pick another option.' }, error: null });
  r = await post(lookABody());
  assert.equal(r.status, 409);
  assert.equal(r.body.reason, 'missing_prescription');
  assert.match(r.body.error, /not set how many sets/);
});

test('a busy workout is retryable; a malformed count is refused before the database', async () => {
  rpcReply = () => ({ data: null, error: { code: 'P0409', message: 'This workout is changing right now. Try again.' } });
  assert.equal((await post(lookABody())).status, 503);
  rpcCalls = [];
  assert.equal((await post(lookABody({ expected_sets: 0 }))).status, 400);
  assert.equal((await post(lookABody({ set_ids: ['nope'] }))).status, 400);
  assert.deepEqual(names(), []);
});

test('an older queued swap (no expected_sets) keeps its unchanged path', async () => {
  tables.workout_log_substitutions = [{ id: SWAP, workout_log_id: LOG, status: 'active' }];
  const body = lookABody({ trigger: 'equipment_busy', reason: 'Rack taken' });
  delete body.expected_sets; delete body.set_ids;
  const r = await post(body);
  assert.equal(r.status, 200);
  assert.equal(r.body.outcome, 'replayed');
  assert.deepEqual(names().filter((n) => n.startsWith('create_')), []);
  tables.workout_log_substitutions = [];
  const created = await post(body);
  assert.equal(created.status, 201);
  assert.deepEqual(names().filter((n) => n.startsWith('create_')), ['create_workout_substitution']);
});

test('a late Add Set under an archived exercise is a 409, not a server error', async () => {
  insertError = { code: 'P0410', message: 'This exercise is no longer in the workout.' };
  const r = await post({ client_operation_id: '88888888-8888-4888-8888-888888888888' }, `/api/workout-logs/${LOG}/exercises/${ORIGINAL}/sets`);
  assert.equal(r.status, 409);
  assert.match(r.body.error, /no longer in the workout/);
});

test('a coach decision on a swap the client took back says so', async () => {
  user = { role: 'coach', coach: { id: 'coach-a' } };
  tables.workout_log_substitutions = [{ id: SWAP, workout_log_id: LOG, status: 'undone' }];
  const r = await post({ event_id: '99999999-9999-4999-8999-999999999999', decision: 'approve' }, `/api/workout-logs/${LOG}/substitutions/${SWAP}/decision`);
  assert.equal(r.status, 409);
  assert.match(r.body.error, /took this swap back/);
});
