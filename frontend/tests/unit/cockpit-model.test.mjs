// Coaching cockpit: heat map, attention ranking, keyboard triage with the
// ten-second coach Undo, station queues, client next-set view and the
// device-local notes store. Fictional data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { COCKPIT_COACH_UNDO_MS } from '../../src/lib/cockpit/config.js';
import {
  attentionItems, classifyHeat, clientNextView, conductorStationQueues, createTriageState, idleMs, keyAction, noteTargetFor,
  pruneCleared, stationQueues, triageReducer, visibleItems,
} from '../../src/lib/cockpit/model.js';
import { addNote, fromServerNote, notesKey, readNotes, resolveNote } from '../../src/lib/cockpit/notes.js';
import { applySetEvent, createWorld, startLog } from '../../src/lib/cockpit/serverSim.js';
import { REPLAY_CLIENTS, REPLAY_COACH } from '../../src/lib/cockpit/replay.js';

const T0 = Date.UTC(2027, 1, 6, 16, 0, 0);
const MIN = 60_000;

function row(overrides = {}) {
  const { log: logOverrides, ...rest } = overrides;
  return {
    clientId: 'client_x', name: 'Fictional X', joinedAtMs: T0, unreadNotices: 0, openPain: [], notes: [],
    log: logOverrides === null ? null : { id: 'log_x', status: 'active', workoutName: 'Day', done: 0, total: 9, lastWriteAtMs: T0, lastActorRole: 'client', openConflicts: 0, pendingSwaps: 0, swapsToReview: 0, ...logOverrides },
    ...rest,
  };
}

function memoryStorage() {
  const map = new Map();
  return { getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key), map };
}

test('heat: done, needs a cue, behind (pace or quiet), on pace, not started', () => {
  const now = T0 + 25 * MIN;
  assert.equal(classifyHeat(row({ log: { done: 9 } }), now), 'done');
  assert.equal(classifyHeat(row({ log: { status: 'completed', done: 4 } }), now), 'done');
  assert.equal(classifyHeat(row({ log: { done: 5, openConflicts: 1, lastWriteAtMs: now } }), now), 'needs_cue');
  assert.equal(classifyHeat(row({ log: { done: 5, lastWriteAtMs: now }, openPain: [{ id: 'n1' }] }), now), 'needs_cue');
  assert.equal(classifyHeat(row({ log: { done: 1, lastWriteAtMs: now } }), now), 'behind');
  assert.equal(classifyHeat(row({ log: { done: 5, lastWriteAtMs: now - 11 * MIN } }), now), 'behind', 'quiet for 11 minutes');
  assert.equal(classifyHeat(row({ log: { done: 5, lastWriteAtMs: now - 8 * MIN } }), now), 'on_pace', 'an 8-minute station change is not quiet');
  assert.equal(classifyHeat(row({ log: { done: 5, lastWriteAtMs: now - MIN } }), now), 'on_pace');
  assert.equal(classifyHeat(row({ log: null }), now), 'not_started');
});

test('pace is measured from arrival on the server clock', () => {
  const now = T0 + 40 * MIN;
  const late = row({ joinedAtMs: T0 + 30 * MIN, log: { done: 2, lastWriteAtMs: now } });
  assert.equal(classifyHeat(late, now), 'on_pace');
  assert.equal(classifyHeat({ ...late, joinedAtMs: T0 }, now), 'behind');
  assert.equal(idleMs(late, now), 0);
});

test('attention is ranked by urgency with a plain reason for each item', () => {
  const now = T0 + 20 * MIN;
  const rows = [
    row({ clientId: 'a', name: 'Avo Test', log: { done: 4, lastWriteAtMs: now } }),
    row({ clientId: 'b', name: 'Bree Test', log: { done: 4, openConflicts: 1, lastWriteAtMs: now } }),
    row({ clientId: 'c', name: 'Cato Test', log: { done: 3, lastWriteAtMs: now - 12 * MIN } }),
    row({ clientId: 'd', name: 'Dima Test', log: { done: 4, pendingSwaps: 1, lastWriteAtMs: now } }),
    row({ clientId: 'e', name: 'Eda Test', joinedAtMs: now - MIN, log: { done: 0, lastWriteAtMs: null } }),
  ];
  const notices = [{ id: 'n1', client_id: 'b', kind: 'set_conflict', summary: 'Bree Test: two values', created_at: new Date(now - 2 * MIN).toISOString() }];
  const items = attentionItems({ rows, serverNowMs: now, notices });
  assert.deepEqual(items.map((item) => `${item.clientId}:${item.kind}`), ['b:conflict', 'd:swap_waiting', 'c:idle', 'e:arrived']);
  assert.deepEqual(items[0].noticeIds, ['n1']);
  assert.match(items[2].reason, /12 min/);
  assert.ok(items.every((item) => item.reason.length > 0));
});

test('an unmatched notice is its own item and keeps its id for the deferred read', () => {
  const now = T0 + 5 * MIN;
  const items = attentionItems({ rows: [row({ log: { done: 2, lastWriteAtMs: now } })], serverNowMs: now, notices: [{ id: 'n9', client_id: 'client_x', kind: 'substitution_used', summary: 'X: used a planned backup', created_at: new Date(now).toISOString() }] });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'notice');
  assert.deepEqual(items[0].noticeIds, ['n9']);
});

const ITEMS = [
  { key: 'a', clientId: 'c1', name: 'A', kind: 'conflict', noticeIds: ['n1'] },
  { key: 'b', clientId: 'c2', name: 'B', kind: 'idle', noticeIds: [] },
  { key: 'c', clientId: 'c3', name: 'C', kind: 'behind', noticeIds: [] },
];

function run(state, type, nowMs, extra = {}) {
  return triageReducer(state, { type, ...extra }, { items: ITEMS, nowMs });
}

test('keyboard triage: next, move, one-key clear, ten-second Undo, then one deferred read', () => {
  let { state } = run(createTriageState(), 'next', 0);
  assert.equal(state.selectedKey, 'a');
  ({ state } = run(state, 'down', 0));
  assert.equal(state.selectedKey, 'b');
  ({ state } = run(state, 'up', 0));
  assert.equal(state.selectedKey, 'a');

  let result = run(state, 'clear', 1_000);
  assert.deepEqual(result.effects, [], 'nothing is sent while Undo is open');
  assert.deepEqual(visibleItems(ITEMS, result.state).map((item) => item.key), ['b', 'c']);
  assert.equal(result.state.selectedKey, 'b', 'selection moves to the next item');
  assert.equal(result.state.pending[0].untilMs, 1_000 + COCKPIT_COACH_UNDO_MS);

  const undone = run(result.state, 'undo', 1_000 + COCKPIT_COACH_UNDO_MS - 1);
  assert.deepEqual(visibleItems(ITEMS, undone.state).map((item) => item.key), ['a', 'b', 'c']);
  assert.equal(undone.state.selectedKey, 'a');
  assert.deepEqual(undone.state.pending, []);

  result = run(state, 'clear', 1_000);
  assert.deepEqual(run(result.state, 'tick', 1_000 + COCKPIT_COACH_UNDO_MS - 1).effects, []);
  const committed = run(result.state, 'tick', 1_000 + COCKPIT_COACH_UNDO_MS);
  assert.deepEqual(committed.effects, [{ type: 'commit', item: ITEMS[0] }]);
  assert.deepEqual(committed.state.pending, []);
  assert.deepEqual(run(committed.state, 'tick', 99_999).effects, [], 'committed once');
  const late = run(committed.state, 'undo', 1_000 + COCKPIT_COACH_UNDO_MS + 1);
  assert.deepEqual(visibleItems(ITEMS, late.state).map((item) => item.key), ['b', 'c'], 'no Undo after the window');
});

test('a clear at time zero still hides its item', () => {
  const { state } = run(createTriageState(), 'clear', 0, { key: 'a' });
  assert.equal(state.cleared.a, 0);
  assert.deepEqual(visibleItems(ITEMS, state).map((item) => item.key), ['b', 'c']);
});

test('several clears within ten seconds each keep their own full Undo window', () => {
  const first = run(createTriageState(), 'clear', 0, { key: 'a' });
  const second = run(first.state, 'clear', 2_000, { key: 'b' });
  assert.deepEqual(second.effects, [], 'a second clear does not cut the first window short');
  assert.deepEqual(second.state.pending.map((entry) => [entry.item.key, entry.untilMs]), [['a', COCKPIT_COACH_UNDO_MS], ['b', 2_000 + COCKPIT_COACH_UNDO_MS]]);
  assert.deepEqual(visibleItems(ITEMS, second.state).map((item) => item.key), ['c']);

  // Undo restores the most recent clear first, then the earlier one.
  const undoB = run(second.state, 'undo', 3_000);
  assert.deepEqual(visibleItems(ITEMS, undoB.state).map((item) => item.key), ['b', 'c']);
  const undoA = run(undoB.state, 'undo', 4_000);
  assert.deepEqual(visibleItems(ITEMS, undoA.state).map((item) => item.key), ['a', 'b', 'c']);

  // Windows expire one at a time, each committing exactly once.
  const atA = run(second.state, 'tick', COCKPIT_COACH_UNDO_MS);
  assert.deepEqual(atA.effects, [{ type: 'commit', item: ITEMS[0] }]);
  assert.deepEqual(atA.state.pending.map((entry) => entry.item.key), ['b']);
  const undoAfterA = run(atA.state, 'undo', COCKPIT_COACH_UNDO_MS + 1);
  assert.deepEqual(visibleItems(ITEMS, undoAfterA.state).map((item) => item.key), ['b', 'c'], 'b is still undoable');
  const atB = run(atA.state, 'tick', 2_000 + COCKPIT_COACH_UNDO_MS);
  assert.deepEqual(atB.effects, [{ type: 'commit', item: ITEMS[1] }]);
  assert.deepEqual(atB.state.pending, []);
});

test('a failed server write restores the cleared item', () => {
  const { state } = run(createTriageState(), 'clear', 0, { key: 'a' });
  const restored = run({ ...state, pending: [] }, 'restore', 20_000, { key: 'a' });
  assert.deepEqual(visibleItems(ITEMS, restored.state).map((item) => item.key), ['a', 'b', 'c']);
});

test('cleared items whose state is gone are pruned', () => {
  const { state } = run(createTriageState(), 'clear', 0, { key: 'c' });
  const settled = { ...state, pending: [] };
  assert.equal(pruneCleared(settled, ITEMS), settled);
  assert.deepEqual(pruneCleared(settled, ITEMS.slice(0, 2)).cleared, {});
});

test('key map: one key per action, never while typing, buttons keep Enter and Space', () => {
  const key = (value, tagName = 'BODY', extra = {}) => keyAction({ key: value, target: { tagName }, ...extra });
  assert.equal(key('c'), 'clear');
  assert.equal(key('C'), 'clear');
  assert.equal(key('ArrowDown'), 'down');
  assert.equal(key('j'), 'down');
  assert.equal(key('ArrowUp'), 'up');
  assert.equal(key('ArrowRight'), 'right');
  assert.equal(key(' '), 'next');
  assert.equal(key('Enter'), 'next');
  assert.equal(key('n'), 'note');
  assert.equal(key('p'), 'pain');
  assert.equal(key('u'), 'undo');
  assert.equal(key('z', 'BODY', { ctrlKey: true }), 'undo');
  assert.equal(key('c', 'BODY', { metaKey: true }), null);
  assert.equal(key('c', 'TEXTAREA'), null);
  assert.equal(key('z', 'INPUT', { ctrlKey: true }), null, 'Ctrl-Z inside a field is the field’s own undo');
  assert.equal(key('z', 'TEXTAREA', { metaKey: true }), null);
  assert.equal(key('z', 'BODY', { metaKey: true, shiftKey: true }), null, 'redo is not undo');
  assert.equal(key('Escape', 'TEXTAREA'), 'escape');
  assert.equal(key('Enter', 'BUTTON'), null);
  assert.equal(key(' ', 'A'), null);
  assert.equal(key('x'), null);
});

test('equipment queues: arrival order fills capacity, the rest wait', () => {
  const queues = stationQueues([{ id: 'C', label: 'Cable', capacity: 1 }], [
    { clientId: 'b', name: 'B', stationId: 'C', sinceMs: 20 },
    { clientId: 'a', name: 'A', stationId: 'C', sinceMs: 10 },
    { clientId: 'c', name: 'C', stationId: 'C', sinceMs: 30 },
  ]);
  assert.deepEqual(queues[0].working.map((entry) => entry.clientId), ['a']);
  assert.deepEqual(queues[0].waiting.map((entry) => entry.clientId), ['b', 'c']);
});

test('live station queues follow the conductor rotation', () => {
  const occupant = (traineeId, name) => ({ traineeId, name, fromRound: 0, toRound: null });
  const queues = conductorStationQueues({
    stations: [{ id: 'A', label: 'Station A' }, { id: 'B', label: 'Station B' }],
    slots: [{ index: 0, occupants: [occupant('t1', 'Ann')] }, { index: 1, occupants: [occupant('t2', 'Ben')] }, { index: 2, occupants: [occupant('t3', 'Cy')] }],
    round: 0,
    roundCount: 2,
  });
  assert.deepEqual(queues[0].working.map((entry) => entry.name), ['Ann', 'Cy']);
  assert.deepEqual(queues[0].waiting.map((entry) => entry.name), ['Ben']);
  assert.deepEqual(queues[1].working.map((entry) => entry.name), ['Ben']);
  assert.deepEqual(conductorStationQueues(null), []);
});

test('client view: next set, load, rest from the server clock, and the note pinned to that set', () => {
  const world = createWorld({ startMs: T0, coaches: [REPLAY_COACH], clients: REPLAY_CLIENTS });
  const log = startLog(world, { clientId: 'client_juno', workoutName: 'Day', exercises: [{ name: 'Back squat', sets: 3, reps: '5', load: 80, unit: 'kg', rest: 150 }] });
  const [first, second, third] = log.exercises[0].sets;
  applySetEvent(world, { set_id: first.id, event_id: 'e1', actor_role: 'client', base_revision: 0, payload: { status: 'completed', actual_reps: 5, actual_load_value: 80, actual_load_unit: 'kg' } });
  assert.deepEqual(noteTargetFor(log), { logId: log.id, setId: second.id, label: 'Back squat · set 2' });
  const notes = [
    { id: 'n1', clientId: 'client_juno', kind: 'cue', text: 'Brace first', setRef: { setId: second.id }, resolved: false },
    { id: 'n2', clientId: 'client_juno', kind: 'cue', text: 'Later', setRef: { setId: third.id }, resolved: false },
  ];
  const view = clientNextView(log, notes, T0 + 30_000);
  assert.equal(view.next.setNumber, 2);
  assert.equal(view.next.setCount, 3);
  assert.equal(view.next.loadValue, 80);
  assert.equal(view.rest.seconds, 150);
  assert.equal(view.rest.remainingMs, 120_000);
  assert.deepEqual(view.notes.map((note) => note.id), ['n1']);
  assert.equal(view.setsDone, 1);
});

test('notes are device-local, validated and namespaced', () => {
  const storage = memoryStorage();
  const scope = 'replay:late';
  assert.equal(notesKey(scope), 'cvf_cockpit_notes:v1:replay:late');
  assert.ok(addNote(storage, scope, { id: 'n1', clientId: 'c', kind: 'cue', text: '   ', createdAtMs: T0 }).error);
  assert.ok(addNote(storage, scope, { id: 'n1', clientId: 'c', kind: 'other', text: 'x', createdAtMs: T0 }).error);
  const { note } = addNote(storage, scope, { id: 'n1', clientId: 'c', kind: 'pain', text: ' Left knee sore ', createdAtMs: T0 });
  assert.equal(note.text, 'Left knee sore');
  assert.equal(note.savedTo, 'this_device');
  assert.equal(readNotes(storage, scope).length, 1);
  assert.equal(resolveNote(storage, scope, 'n1').notes[0].resolved, true);
  storage.setItem(notesKey('broken'), '{not json');
  assert.deepEqual(readNotes(storage, 'broken'), []);
  assert.deepEqual([...storage.map.keys()].sort(), ['cvf_cockpit_notes:v1:broken', 'cvf_cockpit_notes:v1:replay:late']);
});

test('a failed device write is reported and changes nothing', () => {
  const storage = memoryStorage();
  const scope = 'replay:drop';
  addNote(storage, scope, { id: 'n1', clientId: 'c', kind: 'cue', text: 'Brace', createdAtMs: T0 });
  const before = storage.getItem(notesKey(scope));
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  const added = addNote(storage, scope, { id: 'n2', clientId: 'c', kind: 'cue', text: 'Second', createdAtMs: T0 });
  assert.match(added.error, /could not save/);
  assert.equal(added.notes, undefined);
  const resolved = resolveNote(storage, scope, 'n1');
  assert.match(resolved.error, /could not save/);
  assert.equal(resolved.notes[0].resolved, false, 'the returned list is the unchanged one');
  assert.equal(storage.getItem(notesKey(scope)), before);
});

test('server notes map to the model shape with account persistence', () => {
  const note = fromServerNote({ id: 'n1', client_id: 'c', kind: 'pain', text: 'Knee', workout_log_id: 'log', workout_log_set_id: 'set', author_name: 'Coach X', created_at: new Date(T0).toISOString(), resolved_at: null });
  assert.deepEqual(note, { id: 'n1', clientId: 'c', kind: 'pain', text: 'Knee', setRef: { logId: 'log', setId: 'set' }, createdAtMs: T0, author: 'Coach X', resolved: false, savedTo: 'account' });
});
