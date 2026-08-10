// Week-rhythm math (design-plans/011 A): day states, catch-up detection,
// and the morale-safe week streak.
const test = require('node:test');
const assert = require('node:assert/strict');
const { addDays, buildWeekRhythm, weekStart } = require('../src/lib/rhythm');

// 2026-08-12 is a Wednesday; its week starts Monday 2026-08-10.
const TODAY = '2026-08-12';

function assignment(id, date) {
  return { id, assigned_for: date, workout_name: `W-${id}` };
}

test('weekStart finds Monday and addDays crosses months', () => {
  assert.equal(weekStart('2026-08-12'), '2026-08-10');
  assert.equal(weekStart('2026-08-10'), '2026-08-10');
  assert.equal(weekStart('2026-08-16'), '2026-08-10');
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
});

test('day states: done, today, to_make_up, upcoming, rest', () => {
  const rhythm = buildWeekRhythm({
    assignments: [
      assignment('a', '2026-08-10'), // Monday, completed
      assignment('b', '2026-08-11'), // Tuesday, missed
      assignment('c', '2026-08-12'), // today, pending
      assignment('d', '2026-08-14'), // Friday, upcoming
    ],
    completedIds: new Set(['a']),
    today: TODAY,
  });
  const states = Object.fromEntries(rhythm.days.map((d) => [d.date, d.state]));
  assert.equal(states['2026-08-10'], 'done');
  assert.equal(states['2026-08-11'], 'to_make_up');
  assert.equal(states['2026-08-12'], 'today');
  assert.equal(states['2026-08-14'], 'upcoming');
  assert.equal(states['2026-08-13'], 'rest');
  assert.equal(rhythm.week_done, 1);
  assert.equal(rhythm.week_total, 4);
});

test('yesterday_missed powers the catch-up prompt', () => {
  const rhythm = buildWeekRhythm({
    assignments: [assignment('b', '2026-08-11')],
    completedIds: new Set(),
    today: TODAY,
  });
  assert.deepEqual(rhythm.yesterday_missed, [{ id: 'b', workout_name: 'W-b' }]);
  const done = buildWeekRhythm({
    assignments: [assignment('b', '2026-08-11')],
    completedIds: new Set(['b']),
    today: TODAY,
  });
  assert.deepEqual(done.yesterday_missed, []);
});

test('streak counts complete weeks; the in-progress week never breaks it', () => {
  const rhythm = buildWeekRhythm({
    assignments: [
      assignment('w1', '2026-07-28'), // two weeks back, done
      assignment('w2', '2026-08-04'), // last week, done
      assignment('c', '2026-08-14'),  // this week, still upcoming
    ],
    completedIds: new Set(['w1', 'w2']),
    today: TODAY,
  });
  assert.equal(rhythm.week_streak, 2);
});

test('a fully-complete current week joins the streak early', () => {
  const rhythm = buildWeekRhythm({
    assignments: [assignment('w2', '2026-08-04'), assignment('c', '2026-08-11')],
    completedIds: new Set(['w2', 'c']),
    today: TODAY,
  });
  assert.equal(rhythm.week_streak, 2);
});

test('an incomplete past week ends the streak; empty weeks are skipped', () => {
  const broken = buildWeekRhythm({
    assignments: [
      assignment('w0', '2026-07-21'), // three weeks back, done
      assignment('w1', '2026-07-28'), // two weeks back, MISSED
      assignment('w2', '2026-08-04'), // last week, done
    ],
    completedIds: new Set(['w0', 'w2']),
    today: TODAY,
  });
  assert.equal(broken.week_streak, 1);

  const gap = buildWeekRhythm({
    assignments: [
      assignment('w0', '2026-07-21'), // three weeks back, done
      // two weeks back: no assignments (deload) — skipped, not a break
      assignment('w2', '2026-08-04'), // last week, done
    ],
    completedIds: new Set(['w0', 'w2']),
    today: TODAY,
  });
  assert.equal(gap.week_streak, 2);
});
