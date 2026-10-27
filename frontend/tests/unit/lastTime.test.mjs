import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filledSetsLabel, lastTimeFillNote, lastTimeLine, lastTimeSetText, pickLastTimeOccurrence,
} from '../../src/lib/lastTime.js';
import { lastTimeFills } from '../../src/lib/workoutSync.js';

// Midday UTC so the calendar date is the same in any US time zone.
const SEP14 = '2026-09-14T18:00:00.000Z';
const occurrence = {
  completed_at: SEP14, tracking_type: 'reps_weight',
  sets: [
    { set_number: 3, actual_load_value: 40, actual_load_unit: 'lb', actual_reps: 8, actual_rpe: 8 },
    { set_number: 1, actual_load_value: 35, actual_load_unit: 'lb', actual_reps: 10, actual_rpe: 7 },
    { set_number: 2, actual_load_value: 35, actual_load_unit: 'lb', actual_reps: 10, actual_rpe: 7 },
  ],
};

test('the line shows the dated sets the fill would copy, in set order', () => {
  assert.equal(lastTimeLine(occurrence), 'Last time · Sep 14, 2026 · 35 lb × 10 · 35 lb × 10 · 40 lb × 8');
});

test('missing performed values read as a dash, never as zero or a target', () => {
  assert.equal(lastTimeSetText({ set_number: 1, actual_load_value: null, actual_reps: 12 }, occurrence), '— × 12');
  assert.equal(lastTimeSetText({ set_number: 1, actual_load_value: 20, actual_load_unit: 'kg', actual_reps: null }, occurrence), '20 kg × —');
  assert.equal(lastTimeSetText({ set_number: 1, actual_load_value: 0, actual_load_unit: 'lb', actual_reps: 5 }, occurrence), '0 lb × 5');
});

test('duration and distance exercises show their performed metrics', () => {
  const run = { completed_at: SEP14, tracking_type: 'duration_distance', sets: [{ set_number: 1, actual_duration_value: 20, actual_duration_unit: 'min', actual_distance_value: 3, actual_distance_unit: 'km' }] };
  assert.equal(lastTimeLine(run), 'Last time · Sep 14, 2026 · 20 min · 3 km');
  const hold = { completed_at: SEP14, tracking_type: 'duration', sets: [{ set_number: 1, actual_duration_value: null, actual_duration_unit: null }] };
  assert.equal(lastTimeLine(hold), 'Last time · Sep 14, 2026 · —');
});

test('the line and the fill use the same occurrence: newest with the same tracking type', () => {
  const other = { ...occurrence, completed_at: '2026-10-01T18:00:00.000Z', tracking_type: 'duration' };
  const exercise = { tracking_type: 'reps_weight' };
  assert.equal(pickLastTimeOccurrence([other, occurrence], exercise), occurrence);
  assert.equal(pickLastTimeOccurrence([], exercise), null);
  assert.equal(pickLastTimeOccurrence(undefined, exercise), null);
  // The fill rules themselves are unchanged: typed set-1 load is kept.
  const sets = [
    { id: 's1', set_number: 1, status: 'pending', actual_load_value: 40, actual_load_unit: 'lb', actual_reps: null, actual_rpe: null },
    { id: 's2', set_number: 2, status: 'pending', actual_load_value: null, actual_reps: null, actual_rpe: null },
  ];
  const fills = lastTimeFills(sets, pickLastTimeOccurrence([other, occurrence], exercise), exercise);
  assert.deepEqual(fills.map(({ setId, data }) => [setId, data.actual_load_value, data.actual_reps, data.actual_rpe, data.status]), [
    ['s1', 40, 10, 7, 'pending'],
    ['s2', 35, 10, 7, 'pending'],
  ]);
});

test('the fill note names the filled sets as ranges and the source date', () => {
  assert.equal(filledSetsLabel([2]), 'set 2');
  assert.equal(filledSetsLabel([3, 1, 2]), 'sets 1–3');
  assert.equal(filledSetsLabel([1, 3, 5]), 'sets 1, 3, 5');
  assert.equal(filledSetsLabel([1, 2, 4]), 'sets 1, 2, 4');
  assert.equal(filledSetsLabel([1, 2, 3, 5, 6, 7]), 'sets 1–3, 5–7');
  assert.equal(lastTimeFillNote([1, 2, 3], occurrence), 'Filled sets 1–3 from Sep 14, 2026. Typed values kept.');
});
