// PR120 review 4366537624: a station visit must not close while an entered set
// failed to save. The failed entry keeps its ids and is re-sent by Retry
// (flush); rotation stays blocked until it is saved. Actual sync module and
// the committed synthetic in-process server (no HTTP, fictional trainees).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../../src/lib/groupSession.js';
import { createGroupSessionSync } from '../../src/lib/groupSessionSync.js';
import { TRAINEES, createGroupServer } from '../browser/fixtures/groupSessionServer.mjs';

function harness() {
  let seq = 0;
  const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  let session = model.createGroupSession({
    id: uid(), environment: 'test', coachId: 'fict-coach-g1', date: '2026-10-24', title: 'Repair synthetic', trainees: TRAINEES.slice(0, 2),
    stations: [
      { exercise_library_id: 'fict-lib-goblet', name: 'Goblet Squat', sets: '3', reps: '10', default_load_value: '35' },
      { exercise_library_id: 'fict-lib-row', name: 'Cable Row', sets: '3', reps: '10', default_load_value: '35' },
    ],
  });
  const server = createGroupServer();
  const sync = createGroupSessionSync({ api: server.api, getSession: () => session, commit: (fn) => { session = fn(session); } });
  session = model.openVisit(session, { round: 0, slotIndex: 0, traineeId: TRAINEES[0].id, requestId: uid() });
  const key = model.getVisit(session, 0, 0, TRAINEES[0].id).key;
  return { server, sync, key, get: () => session, set: (next) => { session = next; } };
}

test('a visit with a failed entered set stays open, keeps its ids, and Retry saves then closes it', async () => {
  const h = harness();
  h.set(model.recordEntry(h.get(), h.key, 'p1', { reps: 8, load: 35 }));
  await h.sync.saveSet(h.key, 'p1');
  h.set(model.recordEntry(h.get(), h.key, 'p2', { reps: 7, load: 35 }));
  h.server.fault({ method: 'PATCH', path: /\/sets\//, mode: 'no-reach', times: 2 });
  await h.sync.saveSet(h.key, 'p2');
  const failed = h.get().visits[h.key].sets.find((s) => s.key === 'p2');
  assert.equal(failed.state, 'failed');
  const ids = { logId: h.get().visits[h.key].logId, assignmentId: h.get().visits[h.key].assignmentId, setId: failed.setId, eventId: failed.eventId };

  await h.sync.closeRound(0); // its flush fails once more (second fault)
  const afterClose = h.get().visits[h.key];
  assert.notEqual(afterClose.status, 'completed', 'the visit is not closed over an unsaved entry');
  assert.ok(!h.server.db.requests.some((r) => r.method === 'POST' && /\/complete$/.test(r.path)), 'no completion was sent');
  const kept = afterClose.sets.find((s) => s.key === 'p2');
  assert.deepEqual([kept.state, kept.entry], ['failed', { reps: 7, load: 35, unit: 'lb' }]);
  assert.deepEqual({ logId: afterClose.logId, assignmentId: afterClose.assignmentId, setId: kept.setId, eventId: kept.eventId }, ids);
  assert.ok(model.roundBlockers(h.get()).some((b) => /still saving/.test(b)), 'rotation stays blocked');

  // Retry (flush) re-sends the same event; the next close then completes.
  const before = h.server.db.requests.length;
  await h.sync.flush();
  const resent = h.server.db.requests.slice(before).filter((r) => r.method === 'PATCH');
  assert.equal(resent.length, 1);
  assert.equal(resent[0].body.event_id, ids.eventId);
  assert.equal(h.get().visits[h.key].sets.find((s) => s.key === 'p2').state, 'saved');
  await h.sync.closeRound(0);
  assert.equal(h.get().visits[h.key].status, 'completed');
  assert.deepEqual(model.roundBlockers(h.get()).filter((b) => b.startsWith(TRAINEES[0].name)), []);
});

test('a visit whose entries are all saved (or kept as a conflict) still closes normally', async () => {
  const h = harness();
  h.set(model.recordEntry(h.get(), h.key, 'p1', { reps: 8, load: 35 }));
  await h.sync.saveSet(h.key, 'p1');
  await h.sync.closeRound(0);
  assert.equal(h.get().visits[h.key].status, 'completed');
});
