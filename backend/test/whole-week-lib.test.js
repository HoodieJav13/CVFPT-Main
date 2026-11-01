// Whole-week contract helpers, plus parity with the browser copy at
// frontend/src/lib/outsideActivities.js (duplicated across deploy roots).
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
const lib = require('../src/lib/outsideActivities');

const DATE_VECTORS = [
  ['2024-02-29', true], ['2026-02-29', false], ['2026-02-30', false], ['2026-04-31', false], ['2026-13-01', false],
  ['2026-00-10', false], ['2026-3-08', false], ['2026-03-08T00:00', false], [' 2026-03-08', false], ['2026-03-08', true],
  ['2025-11-02', true], [20260308, false], [null, false],
];
const ROWS = [
  { id: 'a', duration_seconds: 3600, effort_rpe: 8 },
  { id: 'b', duration_seconds: 1800, effort_rpe: null },
  { id: 'c', duration_seconds: null, effort_rpe: 5 },
  { id: 'd', duration_seconds: 900, effort_rpe: 9, archived: true },
];

test('strict calendar dates reject impossible days and non-canonical shapes', () => {
  for (const [value, expected] of DATE_VECTORS) assert.equal(lib.isCalendarDate(value), expected, String(value));
});

test('week math is pure calendar arithmetic and DST-safe in Denver', () => {
  assert.equal(lib.mondayOf('2026-03-08'), '2026-03-02');
  assert.equal(lib.mondayOf('2026-03-02'), '2026-03-02');
  assert.equal(lib.mondayOf('2025-11-02'), '2025-10-27');
  assert.equal(lib.addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(lib.addDays('2024-02-28', 1), '2024-02-29');
  const spring = lib.weekInstantRange('2026-03-02');
  assert.equal((Date.parse(spring.end) - Date.parse(spring.start)) / 3600000, 167);
  const fall = lib.weekInstantRange('2025-10-27');
  assert.equal((Date.parse(fall.end) - Date.parse(fall.start)) / 3600000, 169);
  // Denver "today" around midnight on both DST change days.
  assert.equal(lib.denverToday(new Date('2026-03-09T05:59:00Z')), '2026-03-08');
  assert.equal(lib.denverToday(new Date('2026-03-09T06:00:00Z')), '2026-03-09');
  assert.equal(lib.denverToday(new Date('2025-11-03T06:59:00Z')), '2025-11-02');
  assert.equal(lib.denverToday(new Date('2025-11-03T07:00:00Z')), '2025-11-03');
});

test('explicit week selection: default is this Denver week; must be a past or current Monday', () => {
  assert.equal(lib.parseWeekStart(undefined, '2026-03-08'), '2026-03-02');
  assert.equal(lib.parseWeekStart('', '2026-03-08'), '2026-03-02');
  assert.equal(lib.parseWeekStart('2025-10-27', '2026-03-08'), '2025-10-27');
  for (const bad of ['2026-03-03', '2026-03-09', '2026-02-30', ['2026-03-02']]) {
    assert.throws(() => lib.parseWeekStart(bad, '2026-03-08'), (error) => error.status === 400, String(bad));
  }
});

test('summary keeps a known subtotal and a missing-duration count; archived rows never count', () => {
  assert.deepEqual(lib.summarizeOutsideActivities(ROWS), {
    activity_count: 3, known_duration_seconds: 5400, known_duration_count: 2, unknown_duration_count: 1, unknown_effort_count: 1,
  });
  assert.deepEqual(lib.summarizeOutsideActivities([]), {
    activity_count: 0, known_duration_seconds: 0, known_duration_count: 0, unknown_duration_count: 0, unknown_effort_count: 0,
  });
});

test('completed PT workouts bucket by Denver completion day, separate from outside activity', () => {
  const result = lib.bucketCompletedWorkouts([
    { completed_at: '2026-03-08T06:30:00Z' }, { completed_at: '2026-03-09T05:30:00Z' }, { completed_at: '2026-03-09T06:30:00Z' }, { completed_at: null },
  ], '2026-03-02');
  assert.equal(result.by_day['2026-03-07'], 1);
  assert.equal(result.by_day['2026-03-08'], 1);
  assert.equal(result.completed_count, 2, 'Monday 2026-03-09 Denver belongs to the next week');
});

test('normalization: blank text is null, unknown numbers stay null, never 0', () => {
  const fields = lib.normalizeActivityFields({ activity_type: 'hike', occurred_on: '2026-03-07', label: '  ', note: '\n' }, '2026-03-08');
  assert.deepEqual(fields, { activity_type: 'hike', occurred_on: '2026-03-07', label: null, duration_seconds: null, effort_rpe: null, note: null });
  assert.equal(lib.normalizeActivityFields({ activity_type: 'run', occurred_on: '2026-03-08', duration_seconds: 86400, effort_rpe: 10 }, '2026-03-08').duration_seconds, 86400);
  // Character limits count code points, matching SQL char_length.
  assert.equal(lib.normalizeActivityFields({ activity_type: 'run', occurred_on: '2026-03-08', label: '🏃'.repeat(80) }, '2026-03-08').label.length, 160);
  assert.throws(() => lib.normalizeActivityFields({ activity_type: 'run', occurred_on: '2026-03-08', label: '🏃'.repeat(81) }, '2026-03-08'), /80 characters/);
});

test('browser copy stays in parity with the backend contract', async () => {
  const web = await import('../../frontend/src/lib/outsideActivities.js');
  assert.deepEqual(web.ACTIVITY_TYPES, lib.ACTIVITY_TYPES);
  assert.deepEqual(web.LIMITS, lib.LIMITS);
  for (const [value] of DATE_VECTORS) assert.equal(web.isCalendarDate(value), lib.isCalendarDate(value), String(value));
  for (const date of ['2026-03-08', '2026-03-02', '2025-11-02', '2024-02-29', '2026-01-01']) {
    assert.equal(web.mondayOf(date), lib.mondayOf(date), date);
    assert.equal(web.addDays(date, 7), lib.addDays(date, 7), date);
    assert.equal(web.addDays(date, -1), lib.addDays(date, -1), date);
  }
  for (const instant of ['2026-03-09T05:59:00Z', '2026-03-09T06:00:00Z', '2025-11-03T06:59:00Z', '2025-11-03T07:00:00Z']) {
    assert.equal(web.denverToday(new Date(instant)), lib.denverToday(new Date(instant)), instant);
  }
  assert.deepEqual(web.summarizeOutsideActivities(ROWS), lib.summarizeOutsideActivities(ROWS));
  assert.deepEqual(Object.keys(web.ACTIVITY_LABELS), lib.ACTIVITY_TYPES);
});
