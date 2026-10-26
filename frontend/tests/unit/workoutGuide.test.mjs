// P1 active-workout guidance: round-aware next set, compact outline, and the
// explicit repeat-previous-performed-set rule (fictional fixtures).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUntouchedPrefill, nextWork, outlineBlocks, repeatPlan } from '../../src/lib/workoutGuide.js';

const set = (id, n, extra = {}) => ({ id, set_number: n, status: 'pending', actual_load_value: null, actual_load_unit: null, actual_reps: null, actual_rpe: null, revision: 0, ...extra });
const done = (row, reps, load, unit = 'lb') => ({ ...row, status: 'completed', actual_reps: reps, actual_load_value: load, actual_load_unit: load == null ? null : unit, revision: 1 });
const ex = (id, name, sets, extra = {}) => ({ id, exercise_name: name, superset_group: null, tracking_type: 'reps_weight', prescribed_load_value: 35, prescribed_load_unit: 'lb', sets, ...extra });
const complete = (exercises, exerciseId, setId) => exercises.map((row) => (row.id !== exerciseId ? row : { ...row, sets: row.sets.map((s) => (s.id === setId ? done(s, 8, 35) : s)) }));

test('superset rounds: A1 set 1 → A2 set 1 → A1 set 2 → A2 set 2, then the next block', () => {
  let exercises = [
    ex('a1', 'Bench', [set('a1s1', 1), set('a1s2', 2)], { superset_group: 'A' }),
    ex('a2', 'Row', [set('a2s1', 1), set('a2s2', 2)], { superset_group: 'A' }),
    ex('b', 'Squat', [set('bs1', 1)]),
  ];
  const order = [];
  for (let step = 0; step < 5; step += 1) {
    const next = nextWork(exercises);
    order.push(next.setId);
    exercises = complete(exercises, next.exerciseId, next.setId);
  }
  assert.deepEqual(order, ['a1s1', 'a2s1', 'a1s2', 'a2s2', 'bs1']);
  assert.equal(nextWork(exercises), null);
});

test('giant set with unequal set counts keeps round order and skips finished members', () => {
  let exercises = [
    ex('g1', 'Press', [set('g1s1', 1), set('g1s2', 2), set('g1s3', 3)], { superset_group: 'A' }),
    ex('g2', 'Pull', [set('g2s1', 1)], { superset_group: 'A' }),
    ex('g3', 'Carry', [set('g3s1', 1), set('g3s2', 2)], { superset_group: 'A' }),
  ];
  const order = [];
  for (let next = nextWork(exercises); next; next = nextWork(exercises)) {
    order.push(next.setId);
    exercises = complete(exercises, next.exerciseId, next.setId);
  }
  assert.deepEqual(order, ['g1s1', 'g2s1', 'g3s1', 'g1s2', 'g3s2', 'g1s3']);
});

test('resumed or out-of-order work lands on the true next unfinished set', () => {
  const exercises = [
    ex('a1', 'Bench', [done(set('a1s1', 1), 8, 35), done(set('a1s2', 2), 8, 35)], { superset_group: 'A' }),
    ex('a2', 'Row', [done(set('a2s1', 1), 10, 70), set('a2s2', 2)], { superset_group: 'A' }),
    ex('b', 'Squat', [set('bs1', 1)]),
  ];
  assert.equal(nextWork(exercises).setId, 'a2s2');
  const straight = [ex('x', 'Curl', [done(set('x1', 1), 10, 20), set('x2', 2), set('x3', 3)])];
  assert.equal(nextWork(straight).setId, 'x2');
});

test('outline lists names and group labels only, in coach order, with the next exercise marked', () => {
  const exercises = [
    ex('w', 'Warm-up row', [done(set('w1', 1), 1, null)]),
    ex('a1', 'Bench', [set('a1s1', 1)], { superset_group: 'A' }),
    ex('a2', 'Row', [set('a2s1', 1)], { superset_group: 'A' }),
    ex('g1', 'Press', [set('g1s1', 1)], { superset_group: 'B' }),
    ex('g2', 'Pull', [set('g2s1', 1)], { superset_group: 'B' }),
    ex('g3', 'Carry', [set('g3s1', 1)], { superset_group: 'B' }),
  ];
  const blocks = outlineBlocks(exercises);
  assert.deepEqual(blocks.map((b) => b.label), [null, 'Superset B', 'Giant set C']);
  assert.deepEqual(blocks.flatMap((b) => b.items.map((i) => `${i.marker} ${i.name} ${i.status}`)), [
    'A Warm-up row done', 'B1 Bench next', 'B2 Row open', 'C1 Press open', 'C2 Pull open', 'C3 Carry open',
  ]);
  assert.ok(!JSON.stringify(blocks).match(/reps|load|sets":/), 'no sets/reps/loads in the outline');
});

test('repeat copies the previous completed actuals onto untouched prefill only', () => {
  const s1 = done(set('s1', 1, { actual_load_value: 35, actual_load_unit: 'lb' }), 8, 30);
  const s2 = set('s2', 2, { actual_load_value: 35, actual_load_unit: 'lb' });
  const exercise = ex('e', 'Goblet Squat', [s1, s2, set('s3', 3, { actual_load_value: 35, actual_load_unit: 'lb' })]);
  const plan = repeatPlan(exercise, s2);
  assert.equal(plan.available, true);
  assert.equal(plan.label, 'Same as set 1: 30 lb × 8 reps');
  assert.deepEqual({ ...plan.payload }, { actual_load_value: 30, actual_load_unit: 'lb', actual_reps: 8, actual_rpe: null, status: 'completed' });
  // Never copied from the prescription, never onto a set the user touched.
  assert.equal(repeatPlan(exercise, set('s2', 2, { actual_load_value: 35, actual_load_unit: 'lb', actual_reps: 6 })).available, false);
  assert.match(repeatPlan(exercise, set('s2', 2, { actual_load_value: 40, actual_load_unit: 'lb' })).reason, /already has values you entered/);
  assert.match(repeatPlan(exercise, s2, { drafting: true }).reason, /finish or clear what you are typing/);
  assert.match(repeatPlan(exercise, s2, { conflicts: [{ workout_log_set_id: 's2', status: 'open' }] }).reason, /disagreement/);
  assert.equal(repeatPlan(exercise, s2, { conflicts: [{ workout_log_set_id: 's2', status: 'resolved' }] }).available, true);
  assert.equal(repeatPlan(exercise, set('s2', 2, { actual_load_value: 35, actual_load_unit: 'lb', revision: 2 })).available, false, 'a saved revision is not untouched');
});

test('repeat is unavailable without an earlier completed set or without recorded reps', () => {
  const first = set('s1', 1, { actual_load_value: 35, actual_load_unit: 'lb' });
  const exercise = ex('e', 'Bench', [first, set('s2', 2, { actual_load_value: 35, actual_load_unit: 'lb' })]);
  assert.deepEqual(repeatPlan(exercise, first), { available: false, reason: null });
  assert.deepEqual(repeatPlan(exercise, exercise.sets[1]), { available: false, reason: null }, 'nothing completed yet');
  const noReps = ex('e', 'Bench', [{ ...set('s1', 1), status: 'completed', actual_load_value: 30, actual_load_unit: 'lb' }, set('s2', 2, { actual_load_value: 35, actual_load_unit: 'lb' })]);
  assert.match(repeatPlan(noReps, noReps.sets[1]).reason, /set 1 has no recorded reps/);
  // Out of order: a later completed set is not "previous".
  const later = ex('e', 'Bench', [set('s1', 1, { actual_load_value: 35, actual_load_unit: 'lb' }), done(set('s2', 2), 8, 30)]);
  assert.deepEqual(repeatPlan(later, later.sets[0]), { available: false, reason: null });
});

test('repeat keeps bodyweight null load and metric units/semantics', () => {
  const bw = ex('p', 'Push-up', [done(set('p1', 1), 15, null), set('p2', 2)], { prescribed_load_value: null, prescribed_load_unit: null });
  const plan = repeatPlan(bw, bw.sets[1]);
  assert.equal(plan.available, true);
  assert.equal(plan.payload.actual_load_value, null);
  assert.equal(plan.payload.actual_load_unit, null);
  assert.equal(plan.label, 'Same as set 1: 15 reps');
  const runSet1 = { ...set('r1', 1), status: 'completed', actual_duration_value: 12.5, actual_duration_unit: 'min', actual_distance_value: 2, actual_distance_unit: 'km', revision: 1 };
  const run = ex('r', 'Run', [runSet1, set('r2', 2)], { tracking_type: 'duration_distance', prescribed_load_value: null, prescribed_load_unit: null });
  const runPlan = repeatPlan(run, run.sets[1]);
  assert.equal(runPlan.available, true);
  assert.equal(runPlan.payload.actual_duration_value, 12.5);
  assert.equal(runPlan.payload.actual_duration_unit, 'min');
  assert.equal(runPlan.payload.actual_distance_unit, 'km');
  assert.equal(runPlan.payload.actual_reps, null);
  const partial = ex('r', 'Run', [{ ...runSet1, actual_distance_value: null, actual_distance_unit: null }, set('r2', 2)], { tracking_type: 'duration_distance', prescribed_load_value: null });
  assert.match(repeatPlan(partial, partial.sets[1]).reason, /no recorded result/);
});

test('untouched prefill detection', () => {
  const exercise = ex('e', 'Bench', []);
  assert.equal(isUntouchedPrefill(exercise, set('a', 1, { actual_load_value: 35, actual_load_unit: 'lb' })), true);
  assert.equal(isUntouchedPrefill(exercise, set('a', 1, { actual_load_value: '35', actual_load_unit: 'lb' })), true);
  assert.equal(isUntouchedPrefill(exercise, set('a', 1, { actual_load_value: 35, actual_load_unit: 'kg' })), false);
  assert.equal(isUntouchedPrefill(exercise, set('a', 1, { actual_load_value: 35, actual_load_unit: 'lb', actual_rpe: 8 })), false);
});
