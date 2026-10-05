import test from 'node:test';
import assert from 'node:assert/strict';
import { workoutEntryErrors } from '../../src/lib/workoutEntryErrors.js';

test('simultaneous scalar and typed metric errors attach independently', () => {
  const exercise = { tracking_type: 'duration_distance', prescribed_duration_unit: 'min', prescribed_distance_unit: 'km' };
  const entry = { actual_load_value: '-1', actual_rpe: '11', actual_duration_value: '1441', actual_distance_value: '1001' };
  assert.deepEqual(Object.keys(workoutEntryErrors(entry, exercise)).sort(), ['actual_load_value', 'actual_rpe', 'actual_duration_value', 'actual_distance_value'].sort());
  // Correcting one metric preserves the other errors; blanks remain optional.
  assert.deepEqual(Object.keys(workoutEntryErrors({ ...entry, actual_duration_value: '1440' }, exercise)).sort(), ['actual_load_value', 'actual_rpe', 'actual_distance_value'].sort());
  assert.deepEqual(workoutEntryErrors({ actual_load_value: '0', actual_rpe: '', actual_duration_value: '', actual_distance_value: '' }, exercise), {});
});
test('legacy mode reports fractional reps and preserves half-step RPE', () => {
  assert.match(workoutEntryErrors({ actual_reps: '2.5' }, {}).actual_reps, /whole number/);
  assert.deepEqual(workoutEntryErrors({ actual_reps: '0', actual_rpe: '9.5', actual_load_value: '27.5', actual_load_unit: 'lb' }, {}), {});
});
