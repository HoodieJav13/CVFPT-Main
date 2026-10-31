import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rescueVersion, rescueMatches, validateRescueBranch, rescueExercises, rescueDiff, resolveRescue } from '../../src/lib/workoutRescue.js';
const original = { program_id: 'p', day_id: 'd', workout: { id: 'w', goal: 'Strength', exercises: [
  { id: 'a', custom_name: 'Squat', sets: '3', reps: '8', default_load_value: 30 },
  { id: 'b', custom_name: 'Press', sets: '3', reps: '10' },
] } };
const branch = { id: 'short', name: 'Short strength', minutes: 25, equipment: ['dumbbells'], intent: 'Keep squat practice.', enabled: true, items: [{ source_id: 'a', sets: 2 }] };
const plan = () => ({ version: rescueVersion(original), revision: 1, branches: [branch] });
test('matches a complete authored branch, never merges equipment and time fallbacks', () => {
  assert.equal(rescueMatches(branch, { minutes: 25, equipment: ['dumbbells'] }), true);
  assert.equal(rescueMatches(branch, { minutes: 15, equipment: ['dumbbells'] }), false);
  assert.equal(rescueMatches(branch, { minutes: 25, equipment: [] }), false);
  assert.equal(rescueMatches({ ...branch, enabled: false }, { minutes: 50, equipment: ['dumbbells'] }), false);
});
test('validation refuses missing intent, unknown/duplicate exercises, empty branches and invalid counts', () => {
  assert.equal(validateRescueBranch(branch, original), null);
  for (const edit of [{ intent: '' }, { items: [] }, { items: [{ source_id: 'x', sets: 1 }] }, { items: [{ source_id: 'a', sets: 4 }] }, { items: [{ source_id: 'a', sets: 0 }] }, { items: [branch.items[0], branch.items[0]] }, { minutes: 0 }, { equipment: ['unknown'] }]) {
    assert.ok(validateRescueBranch({ ...branch, ...edit }, original));
  }
});
test('resolved branch preserves original prescriptions and order without changing source or completed copies', () => {
  const before = structuredClone(original);
  const result = rescueExercises(original, branch);
  assert.deepEqual(result, [{ ...original.workout.exercises[0], sets: '2' }]);
  result[0].reps = '999';
  assert.deepEqual(original, before);
  assert.deepEqual(rescueDiff(original, branch), [
    { id: 'a', name: 'Squat', change: '3 → 2 sets' }, { id: 'b', name: 'Press', change: 'Dropped' },
  ]);
});
test('original changes, branch revisions, missing branch and unmatched combination all fail closed', () => {
  const context = { minutes: 25, equipment: ['dumbbells'] };
  const request = { branch_id: 'short', version: rescueVersion(original), revision: 1, ...context };
  assert.equal(resolveRescue(original, plan(), request).branch.id, 'short');
  assert.equal(resolveRescue({ ...original, workout: { ...original.workout, goal: 'New intent' } }, plan(), request).error, 'stale_original');
  assert.equal(resolveRescue(original, plan(), { ...request, revision: 0 }).error, 'stale_branch');
  assert.equal(resolveRescue(original, plan(), { ...request, branch_id: 'missing' }).error, 'missing_fallback');
  assert.equal(resolveRescue(original, plan(), { ...request, equipment: [] }).error, 'combination_conflict');
});
test('fingerprint includes prescription, identity and day notes', () => {
  for (const change of [{ ...original, day_notes: 'New cue' }, { ...original, program_id: 'other' }, { ...original, workout: { ...original.workout, exercises: [{ ...original.workout.exercises[0], reps: '5' }] } }]) assert.notEqual(rescueVersion(change), rescueVersion(original));
});
test('diff uses the existing library_exercise DTO name for retained exercises', () => {
  const dto = { ...original, workout: { exercises: [{ id: 'a', library_exercise: { name: 'Goblet Squat' }, sets: '3' }] } };
  assert.equal(rescueDiff(dto, branch)[0].name, 'Goblet Squat');
});
test('malformed fixture inputs fail closed with validation messages', () => {
  for (const edit of [null, {}, { ...branch, name: 12 }, { ...branch, intent: 12 }, { ...branch, items: [null] }]) assert.ok(validateRescueBranch(edit, original));
  assert.equal(rescueMatches(branch, { minutes: 25, equipment: null }), false);
  assert.equal(rescueMatches(branch, { minutes: NaN, equipment: ['dumbbells'] }), false);
});
