const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const sync = () => import(pathToFileURL(path.join(root, 'frontend/src/lib/workoutSync.js')));
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('an added set keeps values edited offline when the real row arrives', async () => {
  const { reconcileAddedSet } = await sync();
  const optimistic = {
    id: 'pending-op1', client_operation_id: 'op1', set_number: 4, set_origin: 'extra',
    status: 'completed', actual_load_value: '55', actual_load_unit: 'lb', actual_reps: '8', actual_rpe: null,
  };
  const server = {
    id: 'set-real', client_operation_id: 'op1', set_number: 4, set_origin: 'extra', created_at: 't',
    status: 'pending', actual_load_value: 35, actual_load_unit: 'lb', actual_reps: null, actual_rpe: null,
  };
  const merged = reconcileAddedSet(optimistic, server);
  assert.equal(merged.id, 'set-real');
  assert.equal(merged.created_at, 't');
  assert.equal(merged.status, 'completed');
  assert.equal(merged.actual_load_value, '55');
  assert.equal(merged.actual_reps, '8');
  assert.deepEqual(reconcileAddedSet(undefined, server), server);
});

test('queued writes for a pending set are re-pointed at its real id', async () => {
  const { rewritePendingSetId } = await sync();
  const op = { kind: 'set', setId: 'pending-op1', url: '/workout-logs/L/sets/pending-op1', data: {} };
  assert.deepEqual(rewritePendingSetId(op, 'pending-op1', 'set-real'), { ...op, setId: 'set-real', url: '/workout-logs/L/sets/set-real' });
  const other = { kind: 'set', setId: 'set-x', url: '/workout-logs/L/sets/set-x' };
  assert.equal(rewritePendingSetId(other, 'pending-op1', 'set-real'), other);
});

test('a queued finish seals the log against every other write', async () => {
  const { isWriteBlocked } = await sync();
  const queue = [{ kind: 'set' }, { kind: 'complete' }];
  for (const kind of ['set', 'note', 'add', 'archive']) assert.equal(isWriteBlocked(queue, { kind }), true, kind);
  assert.equal(isWriteBlocked(queue, { kind: 'complete' }), false);
  assert.equal(isWriteBlocked([{ kind: 'set' }], { kind: 'note' }), false);
});

test('"Same as last time" fills only fields still blank in the current sets', async () => {
  const { lastTimeFills } = await sync();
  const occurrence = { sets: [
    { set_number: 1, actual_load_value: 50, actual_load_unit: 'kg', actual_reps: 8, actual_rpe: 7 },
    { set_number: 2, actual_load_value: 50, actual_load_unit: 'kg', actual_reps: 8, actual_rpe: null },
  ] };
  // Set 1 had reps typed (17) while history loaded; set 2 is untouched.
  const current = [
    { id: 's1', set_number: 1, status: 'pending', actual_load_value: '', actual_load_unit: 'lb', actual_reps: '17', actual_rpe: '' },
    { id: 's2', set_number: 2, status: 'completed', actual_load_value: null, actual_load_unit: null, actual_reps: null, actual_rpe: null },
    { id: 's3', set_number: 3, status: 'pending', actual_load_value: null, actual_reps: null, actual_rpe: null },
  ];
  assert.deepEqual(lastTimeFills(current, occurrence), [
    { setId: 's1', data: { actual_load_value: 50, actual_load_unit: 'kg', actual_reps: 17, actual_rpe: 7, status: 'pending' } },
    { setId: 's2', data: { actual_load_value: 50, actual_load_unit: 'kg', actual_reps: 8, actual_rpe: null, status: 'completed' } },
  ]);
  // Fully typed sets are left alone; no history means nothing.
  const typed = [{ id: 's1', set_number: 1, status: 'pending', actual_load_value: 60, actual_load_unit: 'lb', actual_reps: 5, actual_rpe: 9 }];
  assert.deepEqual(lastTimeFills(typed, occurrence), []);
  assert.deepEqual(lastTimeFills(current, null), []);
});

test('outbox and tracker wire the rules in', () => {
  const outbox = read('frontend/src/lib/workoutOutbox.js');
  const tracker = read('frontend/src/pages/client/WorkoutTracker.jsx');
  const preview = read('frontend/src/lib/previewMode.js');
  assert.match(outbox, /reconcileAddedSet\(set, data\)/);
  assert.match(outbox, /if \(isWriteBlocked\(queueRef\.current, operation\)\) return false;/);
  assert.match(outbox, /resolvedIdsRef\.current\.get\(operation\.setId\)/);
  // History fill reads the latest log after the await, not the stale argument.
  assert.match(tracker, /logRef\.current\?\.exercises\.find\(\(row\) => row\.id === exercise\.id\)/);
  assert.match(tracker, /lastTimeFills\(current\.sets, occurrence, current\)/);
  // Every mutation control honours the sealed state.
  assert.match(tracker, /<Select disabled=\{sealed\}/);
  assert.match(tracker, /disabled=\{sealed\} onClick=\{\(\) => removeSet\(exercise, set\)\}/);
  assert.match(tracker, /value=\{exercise\.client_notes \|\| ''\} disabled=\{sealed\}/);
  // Preview responses are copies, like real HTTP bodies.
  assert.match(preview, /JSON\.parse\(JSON\.stringify\(data\)\)/);
});
