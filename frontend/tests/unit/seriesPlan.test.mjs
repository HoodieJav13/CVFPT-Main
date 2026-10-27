import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sortRows, mapWorkouts, summarizeSelection, ruleLabel, badgeLabel, shiftDate, weekdayOfDate,
  rowsFromBody, pinsFromBody, configFromBody, assignDefault, programGate,
} from '../../src/lib/seriesPlan.js';

const W1 = 'w-1'; const W2 = 'w-2'; const W3 = 'w-3';
const DAYS = [{ day_number: 1, workout_id: W1 }, { day_number: 2, workout_id: W2 }, { day_number: 3, workout_id: W3 }];
// Six Tue/Thu rows R1..R6 starting Tue 2031-06-03.
const six = () => [
  ['R1', '2031-06-03'], ['R2', '2031-06-05'], ['R3', '2031-06-10'],
  ['R4', '2031-06-12'], ['R5', '2031-06-17'], ['R6', '2031-06-19'],
].map(([key, date]) => ({ key, date, time: '17:00', selected: true }));
const assignments = (rows, options = {}) => {
  const mapping = mapWorkouts({ rows, programDays: DAYS, ...options });
  return rows.map((row) => mapping[row.key]);
};

test('no edits: days in order, wrapping after the last day', () => {
  assert.deepEqual(assignments(six()), [W1, W2, W3, W1, W2, W3]);
});

test('an unticked row takes no day, so later rows move up instead of a day being lost', () => {
  const rows = six(); rows[1].selected = false; // R2 (holiday)
  const mapping = mapWorkouts({ rows, programDays: DAYS });
  assert.equal(mapping.R2, undefined);
  assert.deepEqual([mapping.R1, mapping.R3, mapping.R4, mapping.R5, mapping.R6], [W1, W2, W3, W1, W2]);
});

test('a pinned row keeps its workout, consumes its position, and does not shift the next row', () => {
  assert.deepEqual(assignments(six(), { pins: { R3: W1 } }), [W1, W2, W1, W1, W2, W3]);
});

test('a pin to "no workout" (null) still consumes the position', () => {
  assert.deepEqual(assignments(six(), { pins: { R2: null } }), [W1, null, W3, W1, W2, W3]);
});

test('moving a row across another re-maps the automatic rows by chronology; a pin follows its row', () => {
  const moved = six(); moved[0].date = '2031-06-11'; // R1 now between R3 (06-10) and R4 (06-12)
  const auto = mapWorkouts({ rows: moved, programDays: DAYS });
  assert.deepEqual([auto.R2, auto.R3, auto.R1, auto.R4], [W1, W2, W3, W1]);
  const pinned = mapWorkouts({ rows: moved, programDays: DAYS, pins: { R1: W2 } });
  assert.equal(pinned.R1, W2); // pinned, still the third position
  assert.deepEqual([pinned.R2, pinned.R3, pinned.R4], [W1, W2, W1]); // others unchanged
});

test('starting day offsets the sequence; an unknown starting day falls back to the first day', () => {
  assert.deepEqual(assignments(six(), { startingDay: 2 }), [W2, W3, W1, W2, W3, W1]);
  assert.deepEqual(assignments(six(), { startingDay: 9 }), [W1, W2, W3, W1, W2, W3]);
});

test('no program: automatic rows are null, pins still apply', () => {
  const rows = six();
  const mapping = mapWorkouts({ rows, programDays: [], pins: { R2: W3 } });
  assert.equal(mapping.R1, null);
  assert.equal(mapping.R2, W3);
});

test('program days are ordered by day_number regardless of input order', () => {
  const shuffled = [DAYS[2], DAYS[0], DAYS[1]];
  assert.deepEqual(assignments(six(), { programDays: shuffled }), [W1, W2, W3, W1, W2, W3]);
});

test('sortRows is chronological with key as the tie-break and does not mutate its input', () => {
  const rows = [{ key: 'b', date: '2031-06-05', time: '17:00' }, { key: 'a', date: '2031-06-05', time: '17:00' }, { key: 'c', date: '2031-06-03', time: '18:00' }];
  const sorted = sortRows(rows);
  assert.deepEqual(sorted.map((r) => r.key), ['c', 'a', 'b']);
  assert.deepEqual(rows.map((r) => r.key), ['b', 'a', 'c']);
});

test('summarizeSelection reports selected, total, and the last selected date', () => {
  const rows = six(); rows[5].selected = false; rows[4].selected = false;
  assert.deepEqual(summarizeSelection(rows), { selected: 4, total: 6, lastDate: '2031-06-12' });
  assert.deepEqual(summarizeSelection([]), { selected: 0, total: 0, lastDate: null });
});

test('rule label and badge label', () => {
  assert.equal(ruleLabel({ weekdays: [4, 2], interval_weeks: 1 }), 'Weekly · Tue/Thu');
  assert.equal(ruleLabel({ weekdays: [0, 1], interval_weeks: 2 }), 'Every 2 weeks · Mon/Sun');
  assert.equal(badgeLabel({ rule: { weekdays: [2, 4], interval_weeks: 1 }, created_count: 12 }, 3), 'Weekly · Tue/Thu · Session 3 of 12');
});

test('date helpers', () => {
  assert.equal(shiftDate('2031-06-30', 1), '2031-07-01');
  assert.equal(shiftDate('2031-03-01', -1), '2031-02-28');
  assert.equal(weekdayOfDate('2031-06-03'), 2); // Tuesday
});

test('assignDefault: ticked only for a program the client does not already have', () => {
  const unassigned = { id: 'p1', active_assignments: [] };
  const assignedElsewhere = { id: 'p2', active_assignments: [{ client: { id: 'someone-else' } }] };
  const assignedHere = { id: 'p3', active_assignments: [{ client: { id: 'c1' } }] };
  assert.equal(assignDefault(unassigned, 'c1'), true);
  assert.equal(assignDefault(assignedElsewhere, 'c1'), true);
  assert.equal(assignDefault(assignedHere, 'c1'), false);
  assert.equal(assignDefault({ id: 'p4' }, 'c1'), true);   // no assignment list at all
  assert.equal(assignDefault(null, 'c1'), false);          // no program chosen
  assert.equal(assignDefault(undefined, 'c1'), false);
});

const body = () => ({
  request_id: 'r', client_id: 'c', duration_minutes: 60, location: null,
  rule: { start_date: '2031-06-03', time: '17:00', weekdays: [2, 4], interval_weeks: 2, end: { until: '2031-08-01' } },
  slots: [{ key: 'g1', date: '2031-06-03', time: '17:00', workout_id: 'w1' }, { key: 'a1', date: '2031-06-05', time: '17:00', workout_id: null }],
  program_id: 'p1', assign_program: true, notify: false,
});

test('fallback reconstruction: rows come back selected, pins carry the saved workouts (null = none)', () => {
  assert.deepEqual(rowsFromBody(body()).map((r) => [r.key, r.date, r.time, r.selected, r.conflict]),
    [['g1', '2031-06-03', '17:00', true, null], ['a1', '2031-06-05', '17:00', true, null]]);
  assert.deepEqual(pinsFromBody(body()), { g1: 'w1', a1: null });
  assert.deepEqual(rowsFromBody(undefined), []);
  assert.deepEqual(pinsFromBody(undefined), {});
});

test('fallback config: end mode, program, assign and notify come from the body; starting day resets', () => {
  assert.deepEqual(configFromBody(body()), {
    weekdays: [2, 4], intervalWeeks: 2, endMode: 'until', count: 12, until: '2031-08-01',
    programId: 'p1', startingDay: 1, assignProgram: true, notify: false,
  });
  const counted = body(); counted.rule.end = { count: 6 }; counted.notify = true; counted.program_id = null; counted.assign_program = false;
  const config = configFromBody(counted);
  assert.equal(config.endMode, 'count'); assert.equal(config.count, 6); assert.equal(config.programId, ''); assert.equal(config.notify, true);
});

test('programGate: a draft that references a program cannot be saved until that program has really loaded', () => {
  const program = { id: 'p1' };
  assert.equal(programGate({ programId: '', status: 'loading', program: null }), null);       // no program chosen: nothing to wait for
  assert.equal(programGate({ programId: '', status: 'failed', program: null }), null);
  assert.equal(programGate({ programId: 'p1', status: 'loading', program: null }), 'loading'); // restored draft, metadata still in flight
  assert.equal(programGate({ programId: 'p1', status: 'failed', program: null }), 'failed');   // fetch failed: never treated as "no program"
  assert.equal(programGate({ programId: 'p1', status: 'ready', program: null }), 'missing');   // loaded, but the program is gone/archived
  assert.equal(programGate({ programId: 'p1', status: 'ready', program }), null);              // safe to save
  assert.equal(programGate({ programId: 'p1', status: 'loading', program }), 'loading');       // a stale list is not trusted while reloading
});
