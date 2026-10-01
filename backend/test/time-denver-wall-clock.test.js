const test = require('node:test');
const assert = require('node:assert/strict');
const { denverWallClockToUtc, formatDenverDisplay, denverTimeOfDay } = require('../src/utils/time');

test('daylight time (MDT, UTC-6): 5:00 PM on 2026-10-06 is 23:00Z', () => {
  assert.equal(denverWallClockToUtc('2026-10-06', '17:00'), '2026-10-06T23:00:00.000Z');
});

test('standard time (MST, UTC-7): 5:00 PM on 2026-12-01 is 00:00Z the next day', () => {
  assert.equal(denverWallClockToUtc('2026-12-01', '17:00'), '2026-12-02T00:00:00.000Z');
});

test('the same wall-clock time keeps its local hour across the spring-forward boundary', () => {
  const before = denverWallClockToUtc('2026-03-07', '17:00'); // MST
  const after = denverWallClockToUtc('2026-03-09', '17:00'); // MDT
  assert.equal(before, '2026-03-08T00:00:00.000Z');
  assert.equal(after, '2026-03-09T23:00:00.000Z');
  assert.equal(denverTimeOfDay(before), '17:00');
  assert.equal(denverTimeOfDay(after), '17:00');
});

test('spring-forward gap (2:30 AM does not exist on 2026-03-08) resolves forward to 3:30 MDT', () => {
  assert.equal(denverWallClockToUtc('2026-03-08', '02:30'), '2026-03-08T09:30:00.000Z');
  assert.equal(denverTimeOfDay('2026-03-08T09:30:00.000Z'), '03:30');
});

test('fall-back ambiguity (1:30 AM happens twice on 2026-11-01) picks the first, daylight occurrence', () => {
  assert.equal(denverWallClockToUtc('2026-11-01', '01:30'), '2026-11-01T07:30:00.000Z');
});

test('malformed or impossible input returns null', () => {
  for (const [date, time] of [['2026-02-30', '10:00'], ['2026-13-01', '10:00'], ['2026-10-06', '24:00'],
    ['2026-10-06', '9:00'], ['10/06/2026', '10:00'], ['2026-10-06', '10:60'], [null, '10:00'], ['2026-10-06', undefined]]) {
    assert.equal(denverWallClockToUtc(date, time), null, `${date} ${time}`);
  }
});

test('formatDenverDisplay renders weekday, date, and 12-hour time in Denver', () => {
  assert.equal(formatDenverDisplay('2026-10-06T23:00:00.000Z'), 'Tue, Oct 6, 5:00 PM');
});
