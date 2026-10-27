import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SLOTS, parseRule, expandSeriesRule, slotHorizonError, pastError, candidateTimes,
  denverWallClockToUtc, formatDenverDisplay, checkSlots, shiftDate,
} from '../../src/lib/previewSeries.js';

const TODAY = '2026-09-30';
const base = (overrides = {}) => ({
  start_date: '2026-10-06', time: '17:00', duration_minutes: 60,
  weekdays: [2, 4], interval_weeks: 1, end: { count: 6 }, ...overrides,
});
const dates = (rule) => expandSeriesRule(parseRule(rule, { today: TODAY }).value).slots.map((slot) => slot.date);
// Newer ICU versions put a narrow no-break space before AM/PM; compare on plain spaces.
const plain = (text) => text.replace(/\s/g, ' ');

test('Tue/Thu weekly, count 6 starting on a Tuesday', () => {
  assert.deepEqual(dates(base()), ['2026-10-06', '2026-10-08', '2026-10-13', '2026-10-15', '2026-10-20', '2026-10-22']);
});

test('keys are stable and ordered g1..gN', () => {
  const { slots } = expandSeriesRule(parseRule(base(), { today: TODAY }).value);
  assert.deepEqual(slots.map((slot) => slot.key), ['g1', 'g2', 'g3', 'g4', 'g5', 'g6']);
  assert.ok(slots.every((slot) => slot.time === '17:00'));
});

test('every 2 weeks takes every second Monday-start week', () => {
  assert.deepEqual(dates(base({ weekdays: [2], interval_weeks: 2, end: { count: 4 } })),
    ['2026-10-06', '2026-10-20', '2026-11-03', '2026-11-17']);
});

test('weekdays earlier than start_date in its first week are skipped', () => {
  assert.deepEqual(dates(base({ start_date: '2026-10-07', end: { count: 4 } })),
    ['2026-10-08', '2026-10-13', '2026-10-15', '2026-10-20']);
});

test('Sunday sorts last within a Monday-start week', () => {
  assert.deepEqual(dates(base({ start_date: '2026-10-05', weekdays: [0, 1], end: { count: 4 } })),
    ['2026-10-05', '2026-10-11', '2026-10-12', '2026-10-18']);
});

test('until end is inclusive', () => {
  assert.deepEqual(dates(base({ weekdays: [2], end: { until: '2026-10-20' } })), ['2026-10-06', '2026-10-13', '2026-10-20']);
});

test('52 weekly sessions fit the one-year horizon; 53 are rejected', () => {
  const ok = expandSeriesRule(parseRule(base({ weekdays: [2], end: { count: 52 } }), { today: TODAY }).value);
  assert.equal(ok.slots.length, 52);
  assert.equal(ok.exceededMax, false);
  assert.equal(ok.exceededHorizon, false);
  const tooMany = parseRule(base({ end: { count: 53 } }), { today: TODAY });
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.error, 'A series has between 1 and 52 sessions');
});

test('count-based every-2-weeks that runs past the horizon is flagged', () => {
  const result = expandSeriesRule(parseRule(base({ weekdays: [2], interval_weeks: 2, end: { count: 30 } }), { today: TODAY }).value);
  assert.equal(result.exceededHorizon, true);
  assert.ok(result.slots.length < 30);
});

test('until-based rules that would exceed 52 sessions are flagged as exceededMax', () => {
  const result = expandSeriesRule(parseRule(base({ weekdays: [1, 2, 3, 4, 5], end: { until: '2027-10-06' } }), { today: TODAY }).value);
  assert.equal(result.exceededMax, true);
  assert.equal(result.slots.length, MAX_SLOTS + 1);
});

test('parseRule rejects a start in the past and normalizes weekdays Monday-first', () => {
  assert.equal(parseRule(base({ start_date: '2026-09-29' }), { today: TODAY }).error, 'A series cannot start in the past');
  assert.deepEqual(parseRule(base({ weekdays: [0, 4, 2] }), { today: TODAY }).value.weekdays, [2, 4, 0]);
});

test('slot horizon and past messages match the server', () => {
  assert.equal(slotHorizonError([{ date: '2026-09-29' }], '2026-10-06', TODAY), 'Sessions cannot be in the past');
  assert.equal(slotHorizonError([{ date: '2027-10-07' }], '2026-10-06', TODAY), 'Sessions must be within one year of the start date');
  assert.equal(slotHorizonError([{ date: '2027-10-06' }], '2026-10-06', TODAY), null);
  const now = Date.parse('2026-10-06T12:00:00.000Z');
  assert.equal(pastError([{ scheduled_at: '2026-10-06T11:00:00.000Z' }], now), 'Sessions cannot be in the past');
  assert.equal(pastError([{ scheduled_at: '2026-10-06T13:00:00.000Z' }], now), null);
});

test('candidates alternate +15/-15 outward, same date, excluding the requested time', () => {
  const out = candidateTimes({ date: '2026-10-06', time: '12:00' });
  assert.equal(out.length, 24);
  assert.deepEqual(out.slice(0, 4).map((c) => c.time), ['12:15', '11:45', '12:30', '11:30']);
  assert.ok(out.every((c) => c.date === '2026-10-06'));
  assert.ok(!out.some((c) => c.time === '12:00'));
});

test('candidates are clamped to the allowed start times 05:00-20:45', () => {
  const early = candidateTimes({ date: '2026-10-06', time: '05:15' });
  assert.ok(early.every((c) => c.time >= '05:00' && c.time <= '20:45'));
  assert.ok(early.some((c) => c.time === '05:00'));
  const late = candidateTimes({ date: '2026-10-06', time: '20:30' });
  assert.ok(late.every((c) => c.time <= '20:45'));
  assert.ok(late.some((c) => c.time === '20:45'));
});

test('Denver wall clock converts to UTC in both daylight and standard time', () => {
  assert.equal(denverWallClockToUtc('2026-10-06', '17:00'), '2026-10-06T23:00:00.000Z'); // MDT, UTC-6
  assert.equal(denverWallClockToUtc('2026-12-01', '17:00'), '2026-12-02T00:00:00.000Z'); // MST, UTC-7
  assert.equal(denverWallClockToUtc('2026-02-30', '17:00'), null);
  assert.equal(plain(formatDenverDisplay('2026-10-06T23:00:00.000Z')), 'Tue, Oct 6, 5:00 PM');
  assert.equal(shiftDate('2026-10-06', 7), '2026-10-13');
});

// checkSlots drops suggestions at or before nowMs; pin the clock for the fixed-date cases.
const EARLIER = Date.parse('2026-09-30T12:00:00.000Z');

test('checkSlots reports existing conflicts with the three nearest free suggestions', () => {
  const blockedStart = Date.parse(denverWallClockToUtc('2026-10-06', '09:00'));
  const findExisting = (scheduledAt) => {
    const start = Date.parse(scheduledAt);
    const overlaps = blockedStart < start + 3600000 && start < blockedStart + 3600000;
    return overlaps ? { scope: 'coach', session: { id: 'busy', scheduled_at: new Date(blockedStart).toISOString(), duration_minutes: 60 } } : null;
  };
  const [row] = checkSlots({ slots: [{ key: 'g1', date: '2026-10-06', time: '09:00' }], durationMinutes: 60, findExisting, nowMs: EARLIER });
  assert.equal(row.conflict.scope, 'coach');
  assert.equal(row.conflict.session.id, 'busy');
  assert.equal(plain(row.conflict.display), 'Tue, Oct 6, 9:00 AM');
  assert.deepEqual(row.suggestions.map((s) => s.time), ['10:00', '08:00', '10:15']);
  assert.equal(plain(row.suggestions[0].display), 'Tue, Oct 6, 10:00 AM');
});

test('checkSlots flags both rows of a batch conflict and leaves free rows clean', () => {
  const rows = checkSlots({
    slots: [
      { key: 'g1', date: '2026-10-06', time: '09:00' },
      { key: 'g2', date: '2026-10-06', time: '09:30' },
      { key: 'g3', date: '2026-10-13', time: '09:00' },
    ],
    durationMinutes: 60,
    findExisting: () => null,
    nowMs: EARLIER,
  });
  assert.deepEqual(rows[0].conflict, { scope: 'batch', with_key: 'g2', display: null });
  assert.deepEqual(rows[1].conflict, { scope: 'batch', with_key: 'g1', display: null });
  assert.equal(rows[2].conflict, null);
  assert.deepEqual(rows[2].suggestions, []);
  assert.equal(rows[2].scheduled_at, denverWallClockToUtc('2026-10-13', '09:00'));
});

test('checkSlots never suggests a time that has already passed', () => {
  const blockedStart = Date.parse(denverWallClockToUtc('2026-10-06', '09:00'));
  const findExisting = (scheduledAt) => {
    const start = Date.parse(scheduledAt);
    return blockedStart < start + 3600000 && start < blockedStart + 3600000
      ? { scope: 'coach', session: { id: 'busy', scheduled_at: new Date(blockedStart).toISOString(), duration_minutes: 60 } } : null;
  };
  // It is 08:30 Denver on the day: 08:00 is free on the calendar but already gone.
  const nowMs = Date.parse(denverWallClockToUtc('2026-10-06', '08:30'));
  const [row] = checkSlots({ slots: [{ key: 'g1', date: '2026-10-06', time: '09:00' }], durationMinutes: 60, findExisting, nowMs });
  assert.deepEqual(row.suggestions.map((s) => s.time), ['10:00', '10:15', '10:30']);
});
