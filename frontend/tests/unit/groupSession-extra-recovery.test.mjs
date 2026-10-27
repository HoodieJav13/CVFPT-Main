// Independent review of c69031 (PR121 follow-up C): an extra set whose
// creation reached the server but whose reply was lost, on a workout another
// coach device has since finished. Retry must find that extra in the finished
// log by its operation id and send the stored entry once to the late-event
// contract — never create a child on finished history, never reopen or change
// it. A creation that truly never arrived stays explicitly unresolved.
// Actual model, merge and sync modules; committed synthetic server (fictional).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../../src/lib/groupSession.js';
import { createGroupSessionSync } from '../../src/lib/groupSessionSync.js';
import { TRAINEES, createGroupServer } from '../browser/fixtures/groupSessionServer.mjs';

const ANA = TRAINEES[0];
const OPERATION = '00000000-0000-4000-8000-0000000000f1';
const fresh = () => model.createGroupSession({
  id: '00000000-0000-4000-8000-0000000000c3', environment: 'test', coachId: 'fict-coach-g1', date: '2026-10-24', title: 'Extra recovery synthetic', trainees: TRAINEES.slice(0, 2),
  stations: [
    { exercise_library_id: 'fict-lib-goblet', name: 'Goblet Squat', sets: '1', reps: '10', default_load_value: '35' },
    { exercise_library_id: 'fict-lib-row', name: 'Cable Row', sets: '1', reps: '10', default_load_value: '35' },
  ],
});
const clone = (value) => JSON.parse(JSON.stringify(value));

// This device saves set 1, adds an extra set and enters it; the extra's
// creation request meets `creationFault`. Then another device finishes the
// workout and this device adopts that device's plan (visit completed).
async function scenario(creationFault) {
  const server = createGroupServer();
  let session = model.openVisit(fresh(), { round: 0, slotIndex: 0, traineeId: ANA.id, requestId: '00000000-0000-4000-8000-0000000000d5' });
  const sync = createGroupSessionSync({ api: server.api, getSession: () => session, commit: (fn) => { session = fn(session); } });
  const key = model.getVisit(session, 0, 0, ANA.id).key;
  session = model.recordEntry(session, key, 'p1', { reps: 10, load: 35 });
  await sync.saveSet(key, 'p1');
  session = model.addExtraSet(session, key, OPERATION);
  const extraKey = `x${OPERATION}`;
  session = model.recordEntry(session, key, extraKey, { reps: 6, load: 35 });
  server.fault({ method: 'POST', path: /\/exercises\/[^/]+\/sets$/, mode: creationFault, times: 1 });
  await sync.saveSet(key, extraKey);
  const local = clone(session.visits[key].sets.find((s) => s.key === extraKey));
  const logId = session.visits[key].logId;
  // Another coach device finished the workout (set 1 is completed there).
  server.request('POST', `/workout-logs/${logId}/complete`, {});
  const remote = clone(session);
  remote.visits[key] = { ...remote.visits[key], status: 'completed', sets: remote.visits[key].sets.filter((s) => s.key !== extraKey) };
  session = model.keepUnsyncedWork(remote, session);
  const finished = () => clone(server.db.logs.find((l) => l.id === logId));
  return { server, sync, key, extraKey, local, logId, finished, get: () => session };
}
const after = (server, from) => server.db.requests.slice(from);

test('committed extra, lost reply, then finished: Retry finds it by operation id and sends the entry once as a late event', async () => {
  const s = await scenario('drop-reply');
  assert.equal(s.local.state, 'failed');
  assert.equal(s.local.setId ?? null, null, 'the reply with the new set id was lost');
  assert.equal(s.local.operationId, OPERATION);
  const committed = s.finished().exercises[0].sets.find((row) => row.client_operation_id === OPERATION);
  assert.ok(committed, 'the extra exists on the server');
  const kept = s.get().visits[s.key].sets.find((row) => row.key === s.extraKey);
  assert.deepEqual([kept.entry, kept.operationId, kept.setId ?? null], [s.local.entry, OPERATION, null], 'adoption keeps the entry and operation id');
  const historyBefore = s.finished();

  const from = s.server.db.requests.length;
  await s.sync.flush();
  const requests = after(s.server, from);
  assert.equal(requests.filter((r) => r.method === 'POST' && /\/sets$/.test(r.path)).length, 0, 'no second create on finished history');
  const patches = requests.filter((r) => r.method === 'PATCH');
  assert.equal(patches.length, 1, 'the entry is sent once');
  assert.equal(patches[0].path, `/workout-logs/${s.logId}/sets/${committed.id}`, 'to the extra that already exists');
  assert.deepEqual([patches[0].body.actual_reps, patches[0].body.actual_load_value], [6, 35]);
  const set = s.get().visits[s.key].sets.find((row) => row.key === s.extraKey);
  assert.deepEqual([set.setId, set.operationId, set.state], [committed.id, OPERATION, 'conflict'], 'kept as a disagreement under the existing id');
  assert.equal(patches[0].body.event_id, set.eventId);
  assert.deepEqual(s.server.db.conflicts.map((c) => [c.setId, c.eventId]), [[committed.id, set.eventId]]);
  assert.deepEqual(s.finished(), historyBefore, 'finished workout and its sets unchanged');
  assert.equal(s.get().visits[s.key].status, 'completed', 'the visit is not reopened');
  // A second Retry replays nothing new.
  const again = s.server.db.requests.length;
  await s.sync.flush();
  assert.equal(after(s.server, again).filter((r) => r.method !== 'GET').length, 0);
});

test('extra that never reached the server, then finished: kept and explicitly unresolved; no create, no fake success', async () => {
  const s = await scenario('no-reach');
  assert.ok(!s.finished().exercises[0].sets.some((row) => row.client_operation_id === OPERATION), 'the extra does not exist on the server');
  const historyBefore = s.finished();
  const from = s.server.db.requests.length;
  await s.sync.flush();
  const requests = after(s.server, from);
  assert.equal(requests.filter((r) => r.method === 'POST').length, 0, 'never tries to create a child on finished history');
  assert.equal(requests.filter((r) => r.method === 'PATCH').length, 0);
  const set = s.get().visits[s.key].sets.find((row) => row.key === s.extraKey);
  assert.deepEqual([set.entry, set.operationId, set.setId ?? null], [{ reps: 6, load: 35, unit: 'lb' }, OPERATION, null], 'values and identity kept');
  assert.equal(set.state, 'failed', 'not reported as saved');
  assert.match(set.error, /finished before this extra set was created/);
  assert.deepEqual(s.finished(), historyBefore);
  assert.equal(model.unsyncedSets(s.get()).length, 1, 'still visible as waiting');
});
