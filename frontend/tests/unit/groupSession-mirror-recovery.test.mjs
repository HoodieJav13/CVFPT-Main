// Independent frontend review of d39 (PR121 follow-up B): this device's
// write-ahead work, kept when another coach device's plan is adopted, must
// stay recoverable — after that device closed the visit, and when the two
// devices hold the same visit with missing or different server identities.
// Actual model, merge and sync modules with the committed synthetic server
// (fictional data; no HTTP). Two "devices" share one synthetic server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../../src/lib/groupSession.js';
import { createGroupSessionSync } from '../../src/lib/groupSessionSync.js';
import { TRAINEES, createGroupServer } from '../browser/fixtures/groupSessionServer.mjs';

const ANA = TRAINEES[0];
const SESSION_ID = '00000000-0000-4000-8000-0000000000c1';
const STATIONS = [
  { exercise_library_id: 'fict-lib-goblet', name: 'Goblet Squat', sets: '2', reps: '10', default_load_value: '35' },
  { exercise_library_id: 'fict-lib-row', name: 'Cable Row', sets: '2', reps: '10', default_load_value: '35' },
];
const fresh = () => model.createGroupSession({ id: SESSION_ID, environment: 'test', coachId: 'fict-coach-g1', date: '2026-10-24', title: 'Recovery synthetic', trainees: TRAINEES.slice(0, 2), stations: STATIONS });

function device(server, initial) {
  let session = initial;
  const sync = createGroupSessionSync({ api: server.api, getSession: () => session, commit: (fn) => { session = fn(session); } });
  return { sync, get: () => session, set: (next) => { session = next; } };
}
const clone = (value) => JSON.parse(JSON.stringify(value));
const setOf = (session, key, setKey) => session.visits[key].sets.find((s) => s.key === setKey);
const patches = (server, from = 0) => server.db.requests.slice(from).filter((r) => r.method === 'PATCH' && /\/sets\//.test(r.path));

test('a visit the other device completed (round advanced) still sends the kept event once, as a kept disagreement; logged history unchanged', async () => {
  const server = createGroupServer();
  const a = device(server, fresh());
  a.set(model.openVisit(a.get(), { round: 0, slotIndex: 0, traineeId: ANA.id, requestId: '00000000-0000-4000-8000-0000000000d1' }));
  const key = model.getVisit(a.get(), 0, 0, ANA.id).key;
  a.set(model.recordEntry(a.get(), key, 'p1', { reps: 10, load: 35 }));
  await a.sync.saveSet(key, 'p1');
  const beforeEntry = clone(a.get());
  a.set(model.recordEntry(a.get(), key, 'p2', { reps: 7, load: 35 }));
  server.fault({ method: 'PATCH', path: /\/sets\//, mode: 'no-reach', times: 1 });
  await a.sync.saveSet(key, 'p2');
  const kept = clone(setOf(a.get(), key, 'p2'));
  assert.equal(kept.state, 'failed');
  assert.ok(kept.eventId && kept.setId, 'the failed set has its write-ahead event and server set ids');

  // The other device (which never saw p2) closed the visit on the server and rotated.
  const logId = a.get().visits[key].logId;
  server.request('POST', `/workout-logs/${logId}/complete`, {});
  const remote = clone(beforeEntry);
  remote.visits[key] = { ...remote.visits[key], status: 'completed' };
  remote.round = 1;
  a.set(model.keepUnsyncedWork(remote, a.get()));
  assert.deepEqual(clone(setOf(a.get(), key, 'p2')), kept, 'adoption keeps the entry with its ids');
  const serverSetBefore = clone(server.db.logs.find((l) => l.id === logId).exercises[0].sets.find((s) => s.id === kept.setId));

  // Retry: the exact event goes once to the existing late-event contract.
  const from = server.db.requests.length;
  await a.sync.flush();
  const sent = patches(server, from);
  assert.equal(sent.length, 1, 'the kept event is sent');
  assert.equal(sent[0].path, `/workout-logs/${logId}/sets/${kept.setId}`);
  assert.equal(sent[0].body.event_id, kept.eventId);
  assert.equal(sent[0].body.base_revision, kept.serverRevision ?? 0);
  assert.deepEqual([sent[0].body.actual_reps, sent[0].body.actual_load_value], [7, 35]);
  assert.equal(setOf(a.get(), key, 'p2').state, 'conflict', 'kept for the coach as a disagreement');
  assert.equal(server.db.conflicts.length, 1);
  assert.equal(server.db.conflicts[0].eventId, kept.eventId);
  const log = server.db.logs.find((l) => l.id === logId);
  assert.equal(log.status, 'completed', 'the finished workout is not reopened');
  assert.deepEqual(log.exercises[0].sets.find((s) => s.id === kept.setId), serverSetBefore, 'logged performance unchanged');
  assert.equal(a.get().visits[key].status, 'completed');
  assert.equal(model.unsyncedSets(a.get()).length, 0);
  // A second Retry sends nothing more.
  const again = server.db.requests.length;
  await a.sync.flush();
  assert.equal(patches(server, again).length, 0);
});

test('same visit, this device never got server ids: Retry uses the other device\'s established ids, no new Quick Session or start', async () => {
  const server = createGroupServer();
  const base = model.openVisit(fresh(), { round: 0, slotIndex: 0, traineeId: ANA.id, requestId: '00000000-0000-4000-8000-0000000000d2' });
  const key = model.getVisit(base, 0, 0, ANA.id).key;
  const a = device(server, base);
  const b = device(server, clone(base));
  // A: entry whose setup never reached the server.
  a.set(model.recordEntry(a.get(), key, 'p1', { reps: 9, load: 35 }));
  server.fault({ method: 'POST', path: /\/programs\/quick-sessions$/, mode: 'no-reach', times: 1 });
  await a.sync.saveSet(key, 'p1');
  const local = setOf(a.get(), key, 'p1');
  assert.equal(local.state, 'failed');
  assert.equal(local.setId ?? null, null);
  assert.equal(a.get().visits[key].logId ?? null, null);
  // B: same visit (same request id) is set up and a different set saved.
  b.set(model.recordEntry(b.get(), key, 'p2', { reps: 11, load: 35 }));
  await b.sync.saveSet(key, 'p2');
  const remote = clone(b.get());
  assert.ok(remote.visits[key].logId && setOf(remote, key, 'p1').setId);
  const quickBefore = server.db.requests.filter((r) => r.path === '/programs/quick-sessions').length;
  const startBefore = server.db.requests.filter((r) => r.path === '/workout-logs/start').length;

  a.set(model.keepUnsyncedWork(remote, a.get()));
  const from = server.db.requests.length;
  await a.sync.flush();
  const sent = patches(server, from);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].path, `/workout-logs/${remote.visits[key].logId}/sets/${setOf(remote, key, 'p1').setId}`);
  assert.deepEqual([sent[0].body.actual_reps, sent[0].body.actual_load_value], [9, 35]);
  assert.equal(setOf(a.get(), key, 'p1').state, 'saved');
  assert.equal(setOf(a.get(), key, 'p2').state, 'saved', 'the other device\'s saved set is kept');
  assert.equal(server.db.requests.filter((r) => r.path === '/programs/quick-sessions').length, quickBefore, 'no new Quick Session');
  assert.equal(server.db.requests.filter((r) => r.path === '/workout-logs/start').length, startBefore, 'no new start');
  assert.equal(server.db.logs.filter((l) => l.client_id === ANA.id).length, 1);
});

test('same visit key but a different request/log identity: never a mixed tuple; this device\'s work stays recoverable under its own ids', async () => {
  const server = createGroupServer();
  const base = model.openVisit(fresh(), { round: 0, slotIndex: 0, traineeId: ANA.id, requestId: '00000000-0000-4000-8000-0000000000d3' });
  const key = model.getVisit(base, 0, 0, ANA.id).key;
  const a = device(server, base);
  a.set(model.recordEntry(a.get(), key, 'p1', { reps: 8, load: 35 }));
  await a.sync.saveSet(key, 'p1');
  a.set(model.recordEntry(a.get(), key, 'p2', { reps: 6, load: 35 }));
  server.fault({ method: 'PATCH', path: /\/sets\//, mode: 'no-reach', times: 1 });
  await a.sync.saveSet(key, 'p2');
  const localVisit = clone(a.get().visits[key]);
  const kept = clone(setOf(a.get(), key, 'p2'));
  assert.ok(kept.eventId && kept.setId && localVisit.logId);
  // The other device's copy of this key belongs to a different request and log.
  const remote = clone(a.get());
  remote.visits[key] = {
    ...remote.visits[key], requestId: '00000000-0000-4000-8000-0000000000e3', body: { ...remote.visits[key].body, request_id: '00000000-0000-4000-8000-0000000000e3' },
    assignmentId: 'assign-other', logId: 'log-other', logExerciseId: 'logex-other',
    sets: remote.visits[key].sets.map((s) => ({ ...s, setId: `set-other-${s.key}`, entry: null, state: 'empty', eventId: null })),
  };
  const merged = model.keepUnsyncedWork(remote, a.get());
  assert.deepEqual(merged.visits[key], remote.visits[key], 'the other device\'s record of that key is kept as it is');
  const recovery = Object.values(merged.visits).filter((v) => v.key !== key && v.traineeId === ANA.id);
  assert.equal(recovery.length, 1, 'this device\'s visit is kept as its own record');
  assert.deepEqual([recovery[0].requestId, recovery[0].assignmentId, recovery[0].logId, recovery[0].logExerciseId],
    [localVisit.requestId, localVisit.assignmentId, localVisit.logId, localVisit.logExerciseId]);
  assert.deepEqual(clone(recovery[0].sets.find((s) => s.key === 'p2')), kept);
  a.set(merged);
  const from = server.db.requests.length;
  await a.sync.flush();
  const sent = patches(server, from);
  assert.deepEqual(sent.map((r) => [r.path, r.body.event_id]), [[`/workout-logs/${localVisit.logId}/sets/${kept.setId}`, kept.eventId]]);
  assert.ok(!server.db.requests.slice(from).some((r) => r.path.includes('log-other')), 'never sent to the other identity');
});

test('different identity and this device has no server ids: kept, but not sent automatically (no duplicate Quick Session)', () => {
  const base = model.openVisit(fresh(), { round: 0, slotIndex: 0, traineeId: ANA.id, requestId: '00000000-0000-4000-8000-0000000000d4' });
  const key = model.getVisit(base, 0, 0, ANA.id).key;
  let local = model.recordEntry(base, key, 'p1', { reps: 5, load: 35 });
  local = model.updateVisitSet(local, key, 'p1', (s) => ({ ...s, state: 'failed' }));
  const remote = clone(base);
  remote.visits[key] = { ...remote.visits[key], requestId: '00000000-0000-4000-8000-0000000000e4', body: { ...remote.visits[key].body, request_id: '00000000-0000-4000-8000-0000000000e4' }, assignmentId: 'assign-other', logId: 'log-other' };
  const merged = model.keepUnsyncedWork(remote, local);
  assert.deepEqual(merged.visits[key], remote.visits[key]);
  const recovery = Object.values(merged.visits).filter((v) => v.key !== key && v.traineeId === ANA.id);
  assert.equal(recovery.length, 1);
  assert.equal(recovery[0].requestId, '00000000-0000-4000-8000-0000000000d4');
  assert.equal(recovery[0].status, 'blocked', 'needs an explicit coach action before any new record is created');
  assert.match(recovery[0].error, /not sent automatically/);
  assert.equal(recovery[0].sets.find((s) => s.key === 'p1').entry.reps, 5);
  assert.equal(model.unsyncedSets(merged).length, 1, 'still counted as waiting');
});
