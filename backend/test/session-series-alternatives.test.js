const test = require('node:test');
const assert = require('node:assert/strict');
const { candidateTimes, chunk, MAX_ALTERNATIVES_PER_CALL, MAX_SUGGESTIONS_PER_ROW } = require('../src/lib/sessionSeries/alternatives');

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

test('chunk splits into calls of at most the given size and preserves order', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
});

test('52 conflicting rows x 24 candidates (1,248) chunk into calls of at most 600', () => {
  const all = Array.from({ length: 52 * 24 }, (_, i) => i);
  const parts = chunk(all, MAX_ALTERNATIVES_PER_CALL);
  assert.equal(all.length, 1248);
  assert.equal(parts.length, 3);
  assert.ok(parts.every((part) => part.length <= 600));
  assert.equal(parts.flat().length, 1248);
  assert.equal(MAX_SUGGESTIONS_PER_ROW, 3);
});
