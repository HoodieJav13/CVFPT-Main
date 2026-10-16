import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertTarget, exerciseSummary } from '../../src/lib/builderMetrics.js';

test('conversion keeps physical time and distance, rejects blank or invalid targets', () => {
  assert.equal(convertTarget(30, 's', 'min', 'duration'), 0.5);
  assert.equal(convertTarget(0.5, 'min', 's', 'duration'), 30);
  assert.equal(convertTarget(1, 'mi', 'yd', 'distance'), 1760);
  assert.ok(convertTarget(1000000, 'm', 'yd', 'distance') * 0.9144 <= 1000000);
  assert.equal(convertTarget('', 's', 'min', 'duration'), null);
  assert.equal(convertTarget(-1, 's', 'min', 'duration'), null);
});
test('summaries cover optional targets, timed and combined exercises without inventing reps', () => {
  assert.equal(exerciseSummary({ sets: 3, reps: '8–12' }), '3 × 8–12 reps');
  assert.equal(exerciseSummary({ sets: 3, tracking_type: 'duration', duration_value: 30, duration_unit: 's' }), '3 × 30 s');
  assert.equal(exerciseSummary({ sets: 2, tracking_type: 'duration_distance' }), '2 sets');
  assert.equal(exerciseSummary({ tracking_type: 'duration_distance', duration_value: 10, duration_unit: 'min', distance_value: 1, distance_unit: 'mi' }), '10 min + 1 mi');
});
