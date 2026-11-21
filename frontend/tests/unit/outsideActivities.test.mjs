import test from 'node:test';
import assert from 'node:assert/strict';

// Run the date assertions under a far-from-Denver device zone: stored
// YYYY-MM-DD strings must render as the same calendar day everywhere.
process.env.TZ = 'Pacific/Kiritimati';
const lib = await import('../../src/lib/outsideActivities.js');

test('stored historical dates never shift with the device timezone', () => {
  assert.equal(lib.formatDay('2026-03-08'), 'Sun, Mar 8');
  assert.equal(lib.formatDay('2025-11-02'), 'Sun, Nov 2');
  assert.equal(lib.formatWeekRange('2026-03-02'), 'Mar 2 – Mar 8');
  assert.equal(lib.formatDay('2026-02-30'), '');
});

test('week selection is explicit and stable across Denver midnight and DST', () => {
  const beforeMidnight = new Date('2026-03-09T05:59:00Z'); // Sun 23:59 MDT
  const afterMidnight = new Date('2026-03-09T06:01:00Z'); // Mon 00:01 MDT
  assert.equal(lib.resolveWeekStart(null, beforeMidnight), '2026-03-02');
  assert.equal(lib.resolveWeekStart(null, afterMidnight), '2026-03-09');
  // An explicitly chosen week stays put after midnight.
  assert.equal(lib.resolveWeekStart('2026-03-02', afterMidnight), '2026-03-02');
  // Invalid, non-Monday or future selections fall back to the current week.
  assert.equal(lib.resolveWeekStart('2026-03-03', afterMidnight), '2026-03-09');
  assert.equal(lib.resolveWeekStart('2026-03-16', afterMidnight), '2026-03-09');
  assert.equal(lib.resolveWeekStart('2026-02-30', afterMidnight), '2026-03-09');
  assert.equal(lib.denverToday(new Date('2025-11-03T06:59:00Z')), '2025-11-02');
});

test('form fields: blank minutes/effort stay unknown (null), never 0; bounds are enforced', () => {
  const base = { activity_type: 'hike', occurred_on: '2026-03-07', label: ' Trail ', duration_minutes: '', effort_rpe: '', note: '' };
  assert.deepEqual(lib.formToFields(base, '2026-03-08').fields, {
    activity_type: 'hike', occurred_on: '2026-03-07', label: 'Trail', duration_seconds: null, effort_rpe: null, note: null,
  });
  assert.equal(lib.formToFields({ ...base, duration_minutes: '45' }, '2026-03-08').fields.duration_seconds, 2700);
  assert.equal(lib.formToFields({ ...base, duration_minutes: '1440' }, '2026-03-08').fields.duration_seconds, 86400);
  for (const bad of ['0', '1441', '1.5', '-5', 'abc']) assert.ok(lib.formToFields({ ...base, duration_minutes: bad }, '2026-03-08').error, bad);
  for (const bad of ['0', '11', '7.5']) assert.ok(lib.formToFields({ ...base, effort_rpe: bad }, '2026-03-08').error, bad);
  assert.ok(lib.formToFields({ ...base, activity_type: '' }, '2026-03-08').error);
  assert.ok(lib.formToFields({ ...base, occurred_on: '2026-03-09' }, '2026-03-08').error, 'future date');
  assert.ok(lib.formToFields({ ...base, occurred_on: '2026-02-29' }, '2026-03-08').error, 'impossible date');
});

test('editing keeps an exact stored duration unless the minutes are changed', () => {
  const form = lib.activityToForm({ activity_type: 'run', occurred_on: '2026-03-04', label: null, duration_seconds: 1830, effort_rpe: null, note: null });
  assert.equal(form.duration_minutes, '31');
  assert.equal(lib.formToFields(form, '2026-03-08').fields.duration_seconds, 1830);
  assert.equal(lib.formToFields({ ...form, duration_minutes: '30' }, '2026-03-08').fields.duration_seconds, 1800);
  assert.equal(lib.formToFields({ ...form, duration_minutes: '' }, '2026-03-08').fields.duration_seconds, null);
});

test('summary copy: partial totals name the unknowns; empty is not rest or zero load', () => {
  const summary = lib.summarizeOutsideActivities([
    { duration_seconds: 3600, effort_rpe: 8 }, { duration_seconds: 1800, effort_rpe: null }, { duration_seconds: null, effort_rpe: 5 },
  ]);
  assert.equal(lib.summaryText(summary), 'Logged 1 h 30 min across 3 activities; 1 has unknown duration.');
  assert.equal(lib.summaryText(lib.summarizeOutsideActivities([])), 'No outside activities logged this week.');
  assert.equal(lib.summaryText(lib.summarizeOutsideActivities([{ duration_seconds: null }])), '1 activity logged; duration unknown for all of them.');
  for (const text of [lib.summaryText(summary), lib.summaryText(lib.summarizeOutsideActivities([]))]) {
    assert.doesNotMatch(text, /rest|ready|recover|risk|load|score|\b0 min\b/i);
  }
  assert.equal(lib.formatDuration(null), 'Duration unknown');
});

test('visibility and collection copy name who can see records and who controls collection', () => {
  assert.equal(lib.visibilityText({ viewer_role: 'client', coach_name: 'Marcus Rivera' }), 'Shared with Marcus Rivera (assigned coach) and CVF admins.');
  assert.match(lib.visibilityText({ viewer_role: 'coach', coach_name: 'Marcus Rivera' }), /Visible to the client/);
  assert.match(lib.collectionText({ activity_collection: 'default_off' }, 'client'), /off unless your coach turns it on/);
  assert.match(lib.collectionText({ activity_collection: 'client_opted_out' }, 'coach'), /Earlier shared entries stay visible; nobody can add new ones/);
  assert.equal(lib.collectionText({ activity_collection: 'on' }, 'coach'), null);
});
