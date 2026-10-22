// Small-group conductor: session model and retry/ownership sync (fictional
// data, synthetic in-process API; see tests/browser/fixtures/groupSessionServer.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addExtraSet, advanceRound, amendStation, createGroupSession, effectiveExercise, getVisit, openVisit,
  occupantsFor, recordEntry, restoreStation, roundBlockers, stationFor, substituteTrainee, summarize, validateSetup,
} from '../../src/lib/groupSession.js';
import { createGroupSessionSync } from '../../src/lib/groupSessionSync.js';
import { groupSessionKey, loadGroupSession, saveGroupSession } from '../../src/lib/groupSessionStore.js';
import { TRAINEES, createGroupServer } from '../browser/fixtures/groupSessionServer.mjs';

const FOUR = TRAINEES.slice(0, 4).map(({ id, name }) => ({ id, name }));
const SUB = { id: TRAINEES[4].id, name: TRAINEES[4].name };
const STATIONS = [
  { exercise_library_id: 'fict-lib-goblet', name: 'Goblet Squat', sets: '3', reps: '10', default_load_value: '35' },
  { exercise_library_id: 'fict-lib-bench', name: 'Barbell Bench Press', sets: '3', reps: '8', default_load_value: '95' },
  { exercise_library_id: 'fict-lib-row', name: 'Cable Row', sets: '2', reps: '12', default_load_value: '70' },
];
let seq = 0;
const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function newSession() {
  return createGroupSession({ id: uid(), environment: 'test', coachId: 'fict-coach-g1', date: '2026-10-22', title: 'Fictional Tuesday group', trainees: FOUR, stations: STATIONS });
}

function harness(initial = newSession()) {
  const server = createGroupServer();
  let session = initial;
  const commit = (updater) => { session = updater(session); return session; };
  const sync = createGroupSessionSync({ api: server.api, getSession: () => session, commit });
  return { server, sync, get: () => session, commit };
}

function enter(h, slotIndex, setKey, entry) {
  const s = h.get();
  const traineeId = occupantsFor(s, slotIndex, s.round).at(-1).traineeId;
  let visit = getVisit(s, s.round, slotIndex, traineeId);
  if (!visit) {
    h.commit((current) => openVisit(current, { round: current.round, slotIndex, traineeId, requestId: uid() }));
    visit = getVisit(h.get(), h.get().round, slotIndex, traineeId);
  }
  h.commit((current) => recordEntry(current, visit.key, setKey, entry));
  return visit.key;
}

test('setup validation and four-trainee / three-station rotation', () => {
  assert.match(validateSetup({ trainees: FOUR.slice(0, 1), stations: STATIONS })[0], /2 to 6 trainees/);
  assert.match(validateSetup({ trainees: FOUR, stations: [STATIONS[0], { name: '' }] })[0], /Station B needs an exercise/);
  const session = newSession();
  for (let slot = 0; slot < 4; slot += 1) {
    const seen = [0, 1, 2].map((round) => stationFor(session, slot, round).id);
    assert.deepEqual([...new Set(seen)].sort(), ['A', 'B', 'C'], `slot ${slot} visits every station once`);
  }
  assert.equal(stationFor(session, 0, 0).id, stationFor(session, 3, 0).id, 'the fourth trainee shares a station');
});

test('a visit freezes its own trainee, exercise and request body; nobody else appears in it', () => {
  let session = newSession();
  session = openVisit(session, { round: 0, slotIndex: 1, traineeId: FOUR[1].id, requestId: uid() });
  const visit = getVisit(session, 0, 1, FOUR[1].id);
  assert.equal(visit.body.client_id, FOUR[1].id);
  assert.equal(visit.stationId, 'B');
  const text = JSON.stringify(visit.body);
  for (const other of [FOUR[0], FOUR[2], FOUR[3]]) {
    assert.ok(!text.includes(other.id) && !text.includes(other.name), `no trace of ${other.name}`);
  }
  assert.throws(() => openVisit(session, { round: 0, slotIndex: 1, traineeId: FOUR[2].id, requestId: uid() }), /not in this slot/);
});

test('equipment amendment applies to new visits only and never edits the plan', () => {
  let session = newSession();
  session = openVisit(session, { round: 0, slotIndex: 1, traineeId: FOUR[1].id, requestId: uid() });
  session = amendStation(session, { id: uid(), stationId: 'B', exercise: { exercise_library_id: 'fict-lib-dbbench', name: 'DB Bench Press', sets: 3, reps: '10', default_load_value: 30 }, reason: 'Rack pin broke' });
  assert.equal(session.stations[1].plan.name, 'Barbell Bench Press', 'original prescription preserved');
  assert.equal(getVisit(session, 0, 1, FOUR[1].id).exercise.name, 'Barbell Bench Press', 'started visit keeps its exercise');
  session = advanceRound({ ...session, visits: {} });
  const slot = [0, 1, 2, 3].find((index) => stationFor(session, index, 1).id === 'B');
  session = openVisit(session, { round: 1, slotIndex: slot, traineeId: FOUR[slot].id, requestId: uid() });
  const amended = getVisit(session, 1, slot, FOUR[slot].id);
  assert.equal(amended.exercise.name, 'DB Bench Press');
  assert.equal(amended.exercise.replaces, 'Barbell Bench Press');
  assert.ok(!JSON.stringify(amended.body).includes('Rack pin broke'), 'the coach-only reason never reaches the trainee record');
  session = restoreStation(session, { id: uid(), stationId: 'B' });
  assert.equal(effectiveExercise(session, 'B').name, 'Barbell Bench Press');
  assert.equal(session.amendments.length, 2, 'amendments are appended, never rewritten');
});

test('substitution keeps the departing trainee\'s work and refuses duplicates', () => {
  let session = newSession();
  session = openVisit(session, { round: 0, slotIndex: 2, traineeId: FOUR[2].id, requestId: uid() });
  const key = getVisit(session, 0, 2, FOUR[2].id).key;
  session = recordEntry(session, key, 'p1', { reps: 12, load: 70 });
  session = substituteTrainee(session, { slotIndex: 2, substitute: SUB, reason: 'Cam felt dizzy' });
  assert.deepEqual(occupantsFor(session, 2, 0).map((row) => row.traineeId), [FOUR[2].id, SUB.id], 'both present this round');
  assert.deepEqual(occupantsFor(session, 2, 1).map((row) => row.traineeId), [SUB.id], 'only the substitute afterwards');
  assert.equal(getVisit(session, 0, 2, FOUR[2].id).sets[0].entry.reps, 12, 'departing work untouched');
  assert.throws(() => substituteTrainee(session, { slotIndex: 0, substitute: SUB }), /already in this session/);
  assert.throws(() => substituteTrainee(session, { slotIndex: 1, substitute: { id: FOUR[0].id, name: FOUR[0].name } }), /already in this session/);
  // Without recorded work the leaver is simply gone from this round.
  let other = substituteTrainee(newSession(), { slotIndex: 3, substitute: SUB });
  assert.deepEqual(occupantsFor(other, 3, 0).map((row) => row.traineeId), [SUB.id]);
  other = summarize(other);
  assert.equal(other.substitutions, 1);
});

test('entries are validated and closed work cannot be edited', () => {
  let session = openVisit(newSession(), { round: 0, slotIndex: 0, traineeId: FOUR[0].id, requestId: uid() });
  const key = getVisit(session, 0, 0, FOUR[0].id).key;
  assert.throws(() => recordEntry(session, key, 'p1', { reps: '', load: '' }), /reps or weight/);
  assert.throws(() => recordEntry(session, key, 'p1', { reps: '2.5', load: '' }), /whole number/);
  session = { ...session, visits: { ...session.visits, [key]: { ...session.visits[key], status: 'completed' } } };
  assert.throws(() => recordEntry(session, key, 'p1', { reps: 10, load: 35 }), /already closed/);
});

test('retry after lost replies creates one assignment, one log and one extra set', async () => {
  const h = harness();
  h.server.fault({ method: 'POST', path: /^\/programs\/quick-sessions$/, mode: 'drop-reply' });
  const key = enter(h, 0, 'p1', { reps: 10, load: 35 });
  await h.sync.saveSet(key, 'p1');
  assert.equal(h.get().visits[key].sets[0].state, 'failed', 'shown as not saved yet');
  assert.equal(h.server.db.assignments.length, 1, 'the lost reply still created it once');
  h.server.fault({ method: 'PATCH', path: /\/sets\//, mode: 'drop-reply' });
  await h.sync.flush();
  assert.equal(h.get().visits[key].sets[0].state, 'failed');
  await h.sync.flush();
  assert.equal(h.get().visits[key].sets[0].state, 'saved');
  const creates = h.server.db.requests.filter((row) => row.path === '/programs/quick-sessions');
  assert.equal(creates.length, 2);
  assert.deepEqual(creates[0].body, creates[1].body, 'replay is byte-identical');
  assert.equal(h.server.db.assignments.length, 1);
  assert.equal(h.server.db.logs.length, 1);
  // Extra set: the reply is lost after the server added it; the retry reuses the operation id.
  h.commit((s) => addExtraSet(s, key, uid()));
  const extraKey = h.get().visits[key].sets.at(-1).key;
  h.commit((s) => recordEntry(s, key, extraKey, { reps: 8, load: 35 }));
  h.server.fault({ method: 'POST', path: /\/exercises\/[^/]+\/sets$/, mode: 'drop-reply' });
  await h.sync.saveSet(key, extraKey);
  await h.sync.saveSet(key, extraKey);
  const sets = h.server.db.logs[0].exercises[0].sets;
  assert.equal(sets.filter((row) => row.set_origin === 'extra').length, 1, 'exactly one extra set');
  assert.equal(sets.find((row) => row.set_origin === 'extra').actual_reps, 8);
});

test('two trainees at one station write only to their own logs', async () => {
  const h = harness();
  const a = enter(h, 0, 'p1', { reps: 10, load: 35 });
  const d = enter(h, 3, 'p1', { reps: 6, load: 25 });
  await Promise.all([h.sync.saveSet(a, 'p1'), h.sync.saveSet(d, 'p1')]);
  const logA = h.server.db.logs.find((row) => row.client_id === FOUR[0].id);
  const logD = h.server.db.logs.find((row) => row.client_id === FOUR[3].id);
  assert.equal(logA.exercises[0].sets[0].actual_reps, 10);
  assert.equal(logD.exercises[0].sets[0].actual_reps, 6);
  for (const row of h.server.db.requests.filter((r) => r.method === 'PATCH')) {
    const target = row.path.includes(logA.id) ? logA : logD;
    assert.ok(target.exercises[0].sets.some((set) => row.path.endsWith(set.id)), 'each PATCH hits a set inside the addressed log');
  }
  assert.notEqual(h.get().visits[a].logId, h.get().visits[d].logId);
});

test('a log that is not the trainee\'s own is refused before any write', async () => {
  const h = harness();
  const key = enter(h, 1, 'p1', { reps: 8, load: 95 });
  const realPost = h.server.api.post;
  h.server.api.post = async (path, body) => {
    const reply = await realPost(path, body);
    if (path === '/workout-logs/start') reply.data.workout_log.client_id = FOUR[0].id;
    return reply;
  };
  await h.sync.saveSet(key, 'p1');
  assert.equal(h.get().visits[key].status, 'blocked');
  assert.equal(h.server.db.requests.filter((row) => row.method === 'PATCH').length, 0, 'no set write');
});

test('another active workout blocks with no writes; retry after it is finished', async () => {
  const h = harness();
  h.server.db.activeOther.add(FOUR[2].id);
  const key = enter(h, 2, 'p1', { reps: 12, load: 70 });
  await h.sync.saveSet(key, 'p1');
  assert.equal(h.get().visits[key].status, 'blocked');
  assert.match(h.get().visits[key].error, /another workout in progress/);
  assert.equal(h.server.db.logs.length, 0);
  h.server.db.activeOther.delete(FOUR[2].id);
  await h.sync.retryVisit(key);
  assert.equal(h.get().visits[key].sets[0].state, 'saved');
  assert.equal(h.server.db.assignments.length, 1, 'same assignment reused');
});

test('reload resume reads the server back and sends only what is missing', async () => {
  const storage = new Map();
  const store = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) };
  const scope = { environment: 'test', coachId: 'fict-coach-g1' };
  const h = harness();
  const key = enter(h, 0, 'p1', { reps: 10, load: 35 });
  await h.sync.saveSet(key, 'p1');
  h.commit((s) => recordEntry(s, key, 'p2', { reps: 9, load: 35 }));
  h.server.fault({ method: 'PATCH', path: /\/sets\//, mode: 'drop-reply' });
  await h.sync.saveSet(key, 'p2');
  saveGroupSession(store, scope, h.get());
  assert.ok(storage.has(groupSessionKey(scope)));
  // "Reload": a new sync instance over the stored JSON, the same server.
  let session = loadGroupSession(store, scope);
  assert.equal(session.visits[key].sets[1].state, 'failed');
  const sync = createGroupSessionSync({ api: h.server.api, getSession: () => session, commit: (u) => { session = u(session); return session; } });
  const before = h.server.db.requests.length;
  await sync.resume();
  assert.equal(session.visits[key].sets[1].state, 'saved', 'reconciled from the server copy');
  const after = h.server.db.requests.slice(before);
  assert.equal(after.filter((row) => row.method === 'POST').length, 0, 'nothing created again');
  assert.equal(h.server.db.logs[0].exercises[0].sets.filter((row) => row.status === 'completed').length, 2);
  assert.equal(loadGroupSession(store, { ...scope, coachId: 'someone-else' }), null, 'another coach never resumes it');
});

test('closing a round survives a lost reply and abandons work that never saved a set', async () => {
  const h = harness();
  const a = enter(h, 0, 'p1', { reps: 10, load: 35 });
  await h.sync.saveSet(a, 'p1');
  h.server.fault({ method: 'POST', path: /\/complete$/, mode: 'drop-reply' });
  await h.sync.closeRound(0);
  assert.equal(h.get().visits[a].status, 'completed', 'read back as completed, no second complete needed');
  assert.deepEqual(roundBlockers(h.get()), []);
  const next = advanceRound(h.get());
  assert.equal(next.round, 1);
  // A visit whose server set never completed is abandoned, not left open.
  const h2 = harness();
  const b = enter(h2, 1, 'p1', { reps: 8, load: 95 });
  await h2.sync.saveSet(b, 'p1');
  h2.server.db.logs[0].exercises[0].sets[0].status = 'pending';
  await h2.sync.closeVisit(b);
  assert.equal(h2.get().visits[b].status, 'abandoned');
});

test('summary comes from each trainee\'s own saved sets only', async () => {
  const h = harness();
  const a = enter(h, 0, 'p1', { reps: 10, load: 35 });
  const b = enter(h, 1, 'p1', { reps: 8, load: 95 });
  await h.sync.saveSet(a, 'p1');
  await h.sync.saveSet(b, 'p1');
  h.commit((s) => recordEntry(s, b, 'p2', { reps: 8, load: 95 }));
  const summary = summarize(h.get());
  const ana = summary.people.find((row) => row.traineeId === FOUR[0].id);
  const ben = summary.people.find((row) => row.traineeId === FOUR[1].id);
  assert.equal(ana.setsDone, 1);
  assert.equal(ana.volume.lb, 350);
  assert.equal(ben.setsDone, 1, 'the unsaved entry is not counted as done');
  assert.equal(ben.unsynced, 1);
  assert.equal(summary.unsynced, 1);
  assert.equal(summary.totalSets, 2);
});
