const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_SLOTS, parseRule, expandSeriesRule, horizonBounds, validateSlotShapes, slotHorizonError, requestHash, canonicalJson,
} = require('../src/lib/sessionSeries/rule');

const TODAY = '2026-09-30';
const base = (overrides = {}) => ({
  start_date: '2026-10-06', time: '17:00', duration_minutes: 60,
  weekdays: [2, 4], interval_weeks: 1, end: { count: 6 }, ...overrides,
});
const dates = (rule) => expandSeriesRule(parseRule(rule, { today: TODAY }).value).slots.map((slot) => slot.date);

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
  // Wednesday start: Tuesday of that week is before start_date.
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

test('52 weekly sessions fit the one-year horizon; 53 do not', () => {
  const ok = expandSeriesRule(parseRule(base({ weekdays: [2], end: { count: 52 } }), { today: TODAY }).value);
  assert.equal(ok.slots.length, 52);
  assert.equal(ok.exceededMax, false);
  assert.equal(ok.exceededHorizon, false);
  assert.equal(parseRule(base({ end: { count: 53 } }), { today: TODAY }).ok, false);
});

test('count-based every-2-weeks that runs past the horizon is flagged, not silently shortened', () => {
  const result = expandSeriesRule(parseRule(base({ weekdays: [2], interval_weeks: 2, end: { count: 30 } }), { today: TODAY }).value);
  assert.equal(result.exceededHorizon, true);
  assert.ok(result.slots.length < 30);
  assert.ok(result.slots.every((slot) => slot.date <= horizonBounds('2026-10-06', TODAY).max));
});

test('until-based rules that would exceed 52 sessions are flagged as exceededMax', () => {
  const result = expandSeriesRule(parseRule(base({ weekdays: [1, 2, 3, 4, 5], end: { until: '2027-10-06' } }), { today: TODAY }).value);
  assert.equal(result.exceededMax, true);
  assert.equal(result.slots.length, MAX_SLOTS + 1);
});

test('parseRule rejects bad shapes', () => {
  const bad = [
    base({ start_date: '2026-09-29' }), // before today
    base({ start_date: '2026-02-30' }),
    base({ time: '9:00' }),
    base({ duration_minutes: 10 }),
    base({ duration_minutes: 241 }),
    base({ duration_minutes: 60.5 }),
    base({ weekdays: [] }),
    base({ weekdays: [7] }),
    base({ weekdays: [2, 2] }),
    base({ interval_weeks: 3 }),
    base({ end: {} }),
    base({ end: { count: 0 } }),
    base({ end: { until: '2026-10-01' } }), // before start_date
    base({ end: { until: '2027-10-07' } }), // past the horizon (start + 365)
    base({ end: { count: 3, until: '2026-10-20' } }),
  ];
  for (const rule of bad) assert.equal(parseRule(rule, { today: TODAY }).ok, false, JSON.stringify(rule));
  assert.equal(parseRule(null, { today: TODAY }).ok, false);
});

test('parseRule normalizes weekdays to Monday-first order and trims location', () => {
  const parsed = parseRule(base({ weekdays: [0, 4, 2], location: '  CVF Studio ' }), { today: TODAY });
  assert.deepEqual(parsed.value.weekdays, [2, 4, 0]);
  assert.equal(parsed.value.location, 'CVF Studio');
});

test('horizon bounds are inclusive on both ends', () => {
  assert.deepEqual(horizonBounds('2026-10-06', TODAY), { min: '2026-09-30', max: '2027-10-06' });
  assert.equal(slotHorizonError([{ date: '2026-09-30' }, { date: '2027-10-06' }], '2026-10-06', TODAY), null);
  assert.match(slotHorizonError([{ date: '2026-09-29' }], '2026-10-06', TODAY), /past/i);
  assert.match(slotHorizonError([{ date: '2027-10-07' }], '2026-10-06', TODAY), /year/i);
});

test('validateSlotShapes enforces count, unique keys, formats, and workout ids', () => {
  const ok = validateSlotShapes([{ key: 'a', date: '2026-10-06', time: '17:00' }, { key: 'b', date: '2026-10-08', time: '17:00', workout_id: null }]);
  assert.equal(ok.ok, true);
  assert.equal(ok.value[0].workout_id, null);
  const bad = [
    [],
    'x',
    Array.from({ length: 53 }, (_, i) => ({ key: `k${i}`, date: '2026-10-06', time: '17:00' })),
    [{ key: 'a', date: '2026-10-06', time: '17:00' }, { key: 'a', date: '2026-10-08', time: '17:00' }],
    [{ key: '', date: '2026-10-06', time: '17:00' }],
    [{ key: 'a', date: '2026-10-32', time: '17:00' }],
    [{ key: 'a', date: '2026-10-06', time: '25:00' }],
    [{ key: 'a', date: '2026-10-06', time: '17:00', workout_id: 'nope' }],
  ];
  for (const slots of bad) assert.equal(validateSlotShapes(slots).ok, false, JSON.stringify(slots).slice(0, 80));
});

test('requestHash is order-insensitive for object keys and slot order, sensitive to content', () => {
  const a = { client_id: 'c', slots: [{ key: 'a', date: '2026-10-06', time: '17:00' }, { key: 'b', date: '2026-10-08', time: '17:00' }], notify: true };
  const b = { notify: true, slots: [{ time: '17:00', date: '2026-10-08', key: 'b' }, { time: '17:00', date: '2026-10-06', key: 'a' }], client_id: 'c' };
  assert.equal(requestHash(a), requestHash(b));
  assert.notEqual(requestHash(a), requestHash({ ...a, notify: false }));
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
});
