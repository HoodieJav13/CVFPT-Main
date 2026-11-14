// Normal tracker exercise quick completion (final review 2026-11-12 #5),
// fictional fixtures. Mirrors the rehearsal's semantics: entered values kept,
// true blanks stay blank, prescription never copied, all-or-nothing, grouped
// time-limited Undo that refuses sets changed since.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISE_UNDO_MS, exerciseQuickPlan, exerciseUndoPlan, hasEnteredValues } from '../../src/lib/exerciseQuickComplete.js';

// The tracker starts sets with the prescribed load prefilled (revision 0).
const set = (id, n, extra = {}) => ({ id, set_number: n, status: 'pending', actual_load_value: 77.5, actual_load_unit: 'lb', actual_reps: null, actual_rpe: null, revision: 0, ...extra });
const squat = (sets) => ({ id: 'ex_squat', exercise_name: 'Back squat', tracking_type: 'reps_weight', prescribed_load_value: 77.5, prescribed_load_unit: 'lb', prescribed_reps: '5', sets });

test('records 4 reps × 77.5 lb as entered and two untouched sets with no performed values', () => {
  const exercise = squat([set('s1', 1, { actual_reps: '4' }), set('s2', 2), set('s3', 3)]);
  const plan = exerciseQuickPlan(exercise);
  assert.equal(plan.available, true);
  assert.equal(plan.label, 'Record 3 remaining as entered (1 with details, 2 without)');
  assert.deepEqual(plan.entries.map((e) => e.setId), ['s1', 's2', 's3']);
  assert.deepEqual(plan.entries[0].payload, { actual_load_value: 77.5, actual_load_unit: 'lb', actual_reps: 4, actual_rpe: null, status: 'completed' });
  for (const entry of plan.entries.slice(1)) {
    // The prefilled prescription is not a performed value: nothing synthesized.
    assert.deepEqual(entry.payload, { actual_load_value: null, actual_load_unit: null, actual_reps: null, actual_rpe: null, status: 'completed' });
  }
  // Restore reopens each set exactly as it was, prefill included.
  assert.deepEqual(plan.entries[1].restore, { actual_load_value: 77.5, actual_load_unit: 'lb', actual_reps: null, actual_rpe: null, status: 'pending' });
});

test('a typed weight different from the prescription counts as entered; true blanks stay blank', () => {
  const exercise = squat([set('s1', 1, { actual_load_value: '80', actual_reps: '' }), set('s2', 2, { actual_load_value: null, actual_load_unit: null })]);
  const plan = exerciseQuickPlan(exercise);
  assert.equal(plan.withDetails, 1);
  assert.equal(plan.entries[0].payload.actual_load_value, 80);
  assert.equal(plan.entries[0].payload.actual_reps, null);
  assert.equal(plan.entries[1].payload.actual_load_value, null);
  assert.equal(hasEnteredValues(exercise, exercise.sets[1]), false);
});

test('only pending sets of this one exercise are included; completed sets are untouched', () => {
  const exercise = squat([set('s1', 1, { status: 'completed', actual_reps: 5, revision: 2 }), set('s2', 2), set('s3', 3, { status: 'skipped' })]);
  const plan = exerciseQuickPlan(exercise);
  assert.deepEqual(plan.entries.map((e) => e.setId), ['s2']);
  assert.equal(plan.label, 'Record 1 remaining as entered (0 with details, 1 without)');
});

test('refuses when nothing remains, when finished (sealed), on an open conflict, or on an invalid entry — all or nothing', () => {
  assert.equal(exerciseQuickPlan(squat([set('s1', 1, { status: 'completed' })])).available, false);
  assert.equal(exerciseQuickPlan(squat([set('s1', 1)]), { sealed: true }).available, false);
  const conflicted = exerciseQuickPlan(squat([set('s1', 1), set('s2', 2)]), { conflicts: [{ workout_log_set_id: 's2', status: 'open' }] });
  assert.equal(conflicted.available, false);
  assert.match(conflicted.reason, /Set 2 has a disagreement/);
  assert.equal(exerciseQuickPlan(squat([set('s1', 1)]), { conflicts: [{ workout_log_set_id: 's1', status: 'resolved' }] }).available, true);
  const invalid = exerciseQuickPlan(squat([set('s1', 1, { actual_reps: '4' }), set('s2', 2, { actual_reps: '2.5' })]));
  assert.equal(invalid.available, false);
  assert.equal(invalid.invalidSetId, 's2');
  assert.deepEqual(invalid.entries, []);
});

test('duration/distance exercises keep entered metrics and never get reps', () => {
  const plank = { id: 'ex_plank', exercise_name: 'Plank', tracking_type: 'duration', prescribed_duration_value: 30, prescribed_duration_unit: 's', prescribed_load_value: null, sets: [
    { id: 'p1', set_number: 1, status: 'pending', actual_load_value: null, actual_reps: null, actual_rpe: null, actual_duration_value: '45', actual_duration_unit: 's', revision: 0 },
    { id: 'p2', set_number: 2, status: 'pending', actual_load_value: null, actual_reps: null, actual_rpe: null, actual_duration_value: null, actual_duration_unit: null, revision: 0 },
  ] };
  const plan = exerciseQuickPlan(plank);
  assert.equal(plan.withDetails, 1);
  assert.equal(plan.entries[0].payload.actual_duration_value, 45);
  assert.equal(plan.entries[1].payload.actual_duration_value, null);
  assert.equal(plan.entries[1].payload.actual_reps, null);
});

test('grouped Undo restores every set, only within the window, and refuses sets changed since', () => {
  const before = squat([set('s1', 1, { actual_reps: '4' }), set('s2', 2), set('s3', 3)]);
  const plan = exerciseQuickPlan(before);
  const record = { exerciseId: 'ex_squat', entries: plan.entries, expiresMs: 1000 + EXERCISE_UNDO_MS };
  const after = squat(before.sets.map((row, index) => ({ ...row, ...plan.entries[index].payload, revision: 1 })));
  const undo = exerciseUndoPlan(record, after, { nowMs: 2000 });
  assert.equal(undo.available, true);
  assert.deepEqual(undo.entries.map((e) => e.payload.status), ['pending', 'pending', 'pending']);
  assert.equal(undo.entries[0].payload.actual_reps, 4);
  assert.equal(undo.entries[1].payload.actual_load_value, 77.5);
  assert.equal(EXERCISE_UNDO_MS, 6000);
  assert.equal(exerciseUndoPlan(record, after, { nowMs: 1000 + EXERCISE_UNDO_MS }).available, false);
  assert.equal(exerciseUndoPlan(record, after, { nowMs: 2000, sealed: true }).available, false);
  const edited = squat(after.sets.map((row) => (row.id === 's2' ? { ...row, actual_reps: 6 } : row)));
  assert.equal(exerciseUndoPlan(record, edited, { nowMs: 2000 }).available, false);
  const reopened = squat(after.sets.map((row) => (row.id === 's3' ? { ...row, status: 'pending' } : row)));
  assert.equal(exerciseUndoPlan(record, reopened, { nowMs: 2000 }).available, false);
});
