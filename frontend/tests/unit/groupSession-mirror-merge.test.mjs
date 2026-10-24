// Independent review P1 (PR121): adopting another device's station plan must
// keep this device's write-ahead work, and this device's own lost update must
// be recognised regardless of JSON key order (fictional data).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../../src/lib/groupSession.js';
import { TRAINEES } from '../browser/fixtures/groupSessionServer.mjs';

function session() {
  let s = model.createGroupSession({
    id: '00000000-0000-4000-8000-0000000000aa', environment: 'test', coachId: 'fict-coach-g1', date: '2026-10-24', title: 'Merge synthetic', trainees: TRAINEES.slice(0, 2),
    stations: [
      { exercise_library_id: 'fict-lib-goblet', name: 'Goblet Squat', sets: '2', reps: '10', default_load_value: '35' },
      { exercise_library_id: 'fict-lib-row', name: 'Cable Row', sets: '2', reps: '10', default_load_value: '35' },
    ],
  });
  s = model.openVisit(s, { round: 0, slotIndex: 0, traineeId: TRAINEES[0].id, requestId: '00000000-0000-4000-8000-0000000000b1' });
  return s;
}
const keyOf = (s, slot, trainee) => model.getVisit(s, 0, slot, trainee.id).key;

test('another device\'s copy is adopted, but this device\'s unsaved entries and their ids are kept', () => {
  const remote = session();
  let local = remote;
  const ana = keyOf(local, 0, TRAINEES[0]);
  local = model.updateVisit(local, ana, (v) => ({ ...v, logId: 'log-ana', assignmentId: 'asg-ana' }));
  local = model.recordEntry(local, ana, 'p1', { reps: 7, load: 35 });
  local = model.updateVisitSet(local, ana, 'p1', (set) => ({ ...set, state: 'failed', eventId: 'event-ana-1', setId: 'set-ana-1' }));
  // A visit only this device opened, with a pending entry.
  local = model.openVisit(local, { round: 0, slotIndex: 1, traineeId: TRAINEES[1].id, requestId: '00000000-0000-4000-8000-0000000000b2' });
  const ben = keyOf(local, 1, TRAINEES[1]);
  local = model.recordEntry(local, ben, 'p1', { reps: 9, load: 70 });
  // The remote copy changed the title (another device) and knows nothing of these entries.
  const changed = { ...remote, title: 'Renamed on the other device' };

  const merged = model.keepUnsyncedWork(changed, local);
  assert.equal(merged.title, 'Renamed on the other device', 'the other device\'s change is adopted');
  const anaSet = merged.visits[ana].sets.find((s) => s.key === 'p1');
  assert.deepEqual([anaSet.entry, anaSet.state, anaSet.eventId, anaSet.setId], [{ reps: 7, load: 35, unit: 'lb' }, 'failed', 'event-ana-1', 'set-ana-1']);
  assert.deepEqual([merged.visits[ana].logId, merged.visits[ana].assignmentId], ['log-ana', 'asg-ana']);
  assert.equal(merged.visits[ben].sets.find((s) => s.key === 'p1').entry.reps, 9);
  assert.equal(model.unsyncedSets(merged).length, 2);
});

test('saved or conflict-kept sets are not forced over the adopted copy; nothing pending means the remote copy as is', () => {
  const remote = session();
  const ana = keyOf(remote, 0, TRAINEES[0]);
  let local = model.recordEntry(remote, ana, 'p1', { reps: 7, load: 35 });
  local = model.updateVisitSet(local, ana, 'p1', (set) => ({ ...set, state: 'saved' }));
  assert.equal(model.keepUnsyncedWork(remote, local), remote);
  assert.equal(model.keepUnsyncedWork(remote, { ...local, id: 'another-session' }), remote, 'a different session is never merged');
});

test('this device\'s own state is recognised whatever the key order (jsonb reorders keys)', () => {
  const a = session();
  const shuffled = Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(a))).reverse());
  assert.ok(model.sameSessionState(a, shuffled));
  assert.ok(model.sameSessionState(a, JSON.parse(JSON.stringify(a))));
  assert.ok(!model.sameSessionState(a, { ...a, title: 'other' }));
});
