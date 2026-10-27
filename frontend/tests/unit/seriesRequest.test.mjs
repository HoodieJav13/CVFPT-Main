import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeqGuard, classifySaveOutcome, buildCheckBody, buildCreateBody } from '../../src/lib/seriesRequest.js';

test('seq guard: only the latest sequence is current', () => {
  const guard = createSeqGuard();
  const first = guard.next();
  assert.equal(guard.isCurrent(first), true);
  const second = guard.next();
  assert.equal(guard.isCurrent(first), false); // delayed response is stale
  assert.equal(guard.isCurrent(second), true);
});

const axiosError = (status, data) => ({ response: { status, data } });

test('classifySaveOutcome: no response, timeout, and 5xx are UNKNOWN (the server may have committed)', () => {
  assert.deepEqual(classifySaveOutcome(new Error('Network Error')), { kind: 'unknown' });
  assert.deepEqual(classifySaveOutcome({ code: 'ECONNABORTED' }), { kind: 'unknown' });
  for (const status of [500, 502, 503, 504]) assert.deepEqual(classifySaveOutcome(axiosError(status, {})), { kind: 'unknown' });
});

test('classifySaveOutcome: definitive client errors, conflicts, and mismatch', () => {
  assert.deepEqual(classifySaveOutcome(axiosError(400, { error: 'Bad dates' })), { kind: 'definitive', message: 'Bad dates' });
  assert.deepEqual(classifySaveOutcome(axiosError(404, {})), { kind: 'definitive', message: 'Could not save the series' });
  const conflicts = [{ key: 'g1', scope: 'coach' }];
  assert.deepEqual(classifySaveOutcome(axiosError(409, { conflicts })), { kind: 'conflicts', conflicts });
  assert.deepEqual(classifySaveOutcome(axiosError(409, { code: 'request_mismatch' })), { kind: 'mismatch' });
});

const rows = [
  { key: 'b', date: '2031-06-05', time: '17:00', selected: true },
  { key: 'x', date: '2031-06-04', time: '17:00', selected: false },
  { key: 'a', date: '2031-06-03', time: '17:00', selected: true },
];

test('buildCheckBody sends only the selected rows, chronologically, with seq and start_date', () => {
  const body = buildCheckBody({ clientId: 'c', durationMinutes: 60, startDate: '2031-06-03', rows, seq: 4 });
  assert.deepEqual(body, {
    client_id: 'c', duration_minutes: 60, start_date: '2031-06-03', seq: 4,
    slots: [{ key: 'a', date: '2031-06-03', time: '17:00' }, { key: 'b', date: '2031-06-05', time: '17:00' }],
  });
});

test('buildCreateBody applies the final mapping, null-safe, and only assigns when a program is chosen', () => {
  const rule = { start_date: '2031-06-03', time: '17:00', weekdays: [2, 4], interval_weeks: 1, end: { count: 2 } };
  const body = buildCreateBody({
    requestId: 'req', clientId: 'c', durationMinutes: 60, location: '', rule, rows,
    mapping: { a: 'w1' }, programId: '', assignProgram: true, notify: false,
  });
  assert.equal(body.request_id, 'req');
  assert.equal(body.location, null);
  assert.deepEqual(body.slots, [
    { key: 'a', date: '2031-06-03', time: '17:00', workout_id: 'w1' },
    { key: 'b', date: '2031-06-05', time: '17:00', workout_id: null },
  ]);
  assert.equal(body.program_id, null);
  assert.equal(body.assign_program, false); // no program -> never assign
  assert.equal(body.notify, false);
  assert.deepEqual(body.rule, rule);
  const withProgram = buildCreateBody({ requestId: 'r', clientId: 'c', durationMinutes: 60, location: 'Studio', rule, rows, mapping: {}, programId: 'p', assignProgram: true, notify: true });
  assert.equal(withProgram.program_id, 'p');
  assert.equal(withProgram.assign_program, true);
});
