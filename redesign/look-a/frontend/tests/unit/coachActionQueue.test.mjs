import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCoachActionQueue, buildCoachQueueGroups, QUEUE_LIMIT } from '../../src/lib/coachActionQueue.js';

const attention = (id, ...codes) => ({ client_id: id, client_name: `Client ${id}`, reasons: codes.map((code) => ({ code, label: `${code} label` })) });

test('Look A groups: only low adherence is Missed; everything else stays in Needs a look in priority order', () => {
  const dashboard = {
    pending_bookings: [{ id: 'b1', client_id: 'c1', client: { name: 'C1' } }],
    recent_messages: [{ client_id: 'c2', sender_role: 'client', read_by_recipient: false, client: { name: 'C2' } }],
  };
  const groups = buildCoachQueueGroups(dashboard, [attention('c3', 'no_check_in', 'low_adherence'), attention('c4', 'session_gap')]);
  assert.deepEqual(groups.needsLook.map((row) => row.kind), ['booking', 'message', 'attention']);
  assert.deepEqual(groups.missed.map((row) => row.title), ['Client c3']);
  assert.deepEqual(groups.missed[0].reasons.map((reason) => reason.code), ['low_adherence', 'no_check_in']);
  assert.equal(groups.onTrack, null);
  assert.equal(groups.shown, 4);
  assert.equal(groups.total, 4);
});

test('Look A groups keep the 12-item cut and report what was not shown', () => {
  const many = Array.from({ length: 15 }, (_, index) => attention(`c${index}`, index % 2 ? 'low_adherence' : 'no_check_in'));
  const groups = buildCoachQueueGroups({}, many);
  assert.equal(groups.shown, QUEUE_LIMIT);
  assert.equal(groups.total, 15);
  assert.equal(groups.needsLook.length + groups.missed.length, QUEUE_LIMIT);
  const keys = (rows) => rows.map((row) => row.key).sort();
  assert.deepEqual(keys(buildCoachActionQueue({}, many)), keys([...groups.needsLook, ...groups.missed]));
});

test('no attention data (partial or empty) never produces an On track group', () => {
  const groups = buildCoachQueueGroups({}, []);
  assert.equal(groups.onTrack, null);
  assert.deepEqual([groups.needsLook, groups.missed, groups.shown], [[], [], 0]);
});
