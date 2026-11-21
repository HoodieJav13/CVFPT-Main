// Coaching cockpit: event ordering, dedupe, reconnect and time disagreement
// against the in-memory session-event contract (serverSim mirrors
// apply_workout_set_event and the conductor routes) and the fictional replays.
// Fictional data only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applySetEvent, completeLog, createGroupSession, createWorld, groupOverview, listNotices, markNoticeRead, patchGroupSession, resolveConflict, startLog,
} from '../../src/lib/cockpit/serverSim.js';
import {
  REPLAY_CLIENTS, REPLAY_COACH, REPLAY_OTHER_COACH, REPLAY_SCENARIOS, createDevice, deviceWrite, flushDevice, replayAt,
} from '../../src/lib/cockpit/replay.js';
import { attentionItems, buildRoster, classifyHeat } from '../../src/lib/cockpit/model.js';

const START = Date.UTC(2027, 1, 6, 16, 0, 0);
const COACH = REPLAY_COACH.id;
const done = (reps) => ({ status: 'completed', actual_reps: reps, actual_load_value: 80, actual_load_unit: 'kg' });

function fixture() {
  const world = createWorld({ startMs: START, coaches: [REPLAY_COACH, REPLAY_OTHER_COACH], clients: REPLAY_CLIENTS });
  const log = startLog(world, { clientId: 'client_juno', workoutName: 'Test day', exercises: [{ name: 'Back squat', station: 'A', sets: 3, reps: '5', load: 80, unit: 'kg', rest: 150 }] });
  return { world, log, set: (index) => log.exercises[0].sets[index] };
}

test('a resent event id replays without a second write', () => {
  const { world, set } = fixture();
  const event = { set_id: set(0).id, event_id: 'juno:e1', actor_role: 'client', base_revision: 0, local_seq: 1, payload: done(5) };
  assert.equal(applySetEvent(world, event).body.event.outcome, 'applied');
  const again = applySetEvent(world, event);
  assert.equal(again.status, 200);
  assert.equal(again.body.event.outcome, 'replayed');
  assert.equal(again.body.event.original_outcome, 'applied');
  assert.equal(set(0).revision, 1);
  assert.equal(Object.keys(world.events).length, 1);
});

test('an event id reused on a different set is refused', () => {
  const { world, set } = fixture();
  applySetEvent(world, { set_id: set(0).id, event_id: 'juno:e1', actor_role: 'client', base_revision: 0, payload: done(5) });
  const reused = applySetEvent(world, { set_id: set(1).id, event_id: 'juno:e1', actor_role: 'client', base_revision: 0, payload: done(5) });
  assert.equal(reused.status, 409);
  assert.equal(reused.body.error, 'That event id belongs to another set');
  assert.equal(set(1).status, 'pending');
});

test('a stale write from the other side keeps both values as one disagreement and one notice', () => {
  const { world, set } = fixture();
  assert.equal(applySetEvent(world, { set_id: set(0).id, event_id: 'coach:e1', actor_role: 'coach', actor_coach_id: COACH, base_revision: 0, payload: done(5) }).body.event.outcome, 'applied');
  const stale = applySetEvent(world, { set_id: set(0).id, event_id: 'juno:e1', actor_role: 'client', base_revision: 0, offline: true, payload: done(4) });
  assert.equal(stale.body.event.outcome, 'conflict');
  assert.equal(set(0).actual_reps, 5, 'the earlier value is never overwritten');
  assert.equal(world.conflicts.length, 1);
  assert.deepEqual(listNotices(world, COACH).body.notices.map((row) => row.kind), ['set_conflict']);

  assert.equal(applySetEvent(world, { set_id: set(0).id, event_id: 'juno:e1', actor_role: 'client', base_revision: 0, payload: done(4) }).body.event.original_outcome, 'conflict');
  assert.equal(applySetEvent(world, { set_id: set(0).id, event_id: 'juno:e2', actor_role: 'client', base_revision: 0, payload: done(3) }).body.event.outcome, 'conflict');
  assert.equal(world.conflicts.length, 1, 'one open disagreement per set per side');
  assert.equal(world.conflicts[0].incoming_value.actual_reps, 3);
  assert.equal(listNotices(world, COACH).body.notices.length, 1, 'the notice is deduplicated');
});

test('a stale write with the same value is unchanged', () => {
  const { world, set } = fixture();
  applySetEvent(world, { set_id: set(0).id, event_id: 'coach:e1', actor_role: 'coach', actor_coach_id: COACH, base_revision: 0, payload: done(5) });
  assert.equal(applySetEvent(world, { set_id: set(0).id, event_id: 'juno:e1', actor_role: 'client', base_revision: 0, payload: done(5) }).body.event.outcome, 'unchanged');
  assert.equal(world.conflicts.length, 0);
});

test('two devices of the same client: the later arrival is applied and no disagreement is recorded', () => {
  const { world, set } = fixture();
  applySetEvent(world, { set_id: set(0).id, event_id: 'phone:e1', actor_role: 'client', base_revision: 0, local_seq: 1, payload: done(5) });
  const tablet = applySetEvent(world, { set_id: set(0).id, event_id: 'tablet:e1', actor_role: 'client', base_revision: 0, local_seq: 1, payload: done(4) });
  assert.equal(tablet.body.event.outcome, 'applied');
  assert.equal(set(0).actual_reps, 4);
  assert.equal(set(0).revision, 2);
  assert.equal(world.conflicts.length, 0);
});

test('a write that arrives after Finish never reopens the log', () => {
  const { world, log, set } = fixture();
  completeLog(world, log.id);
  const late = applySetEvent(world, { set_id: set(1).id, event_id: 'juno:e9', actor_role: 'client', base_revision: 0, payload: done(5) });
  assert.equal(late.body.event.outcome, 'conflict');
  assert.equal(set(1).status, 'pending');
  assert.equal(log.status, 'completed');
});

test('offline writes queue in order, and a lost reply is resent with the same id', () => {
  const { world, set } = fixture();
  const phone = createDevice({ id: 'juno_phone', label: 'Phone', actorRole: 'client', clientId: 'client_juno' });
  phone.online = false;
  deviceWrite(world, phone, set(0).id, done(5));
  deviceWrite(world, phone, set(1).id, done(5));
  assert.equal(phone.outbox.length, 2);
  assert.equal(phone.outbox[0].offline, true);
  assert.deepEqual(phone.outbox.map((op) => op.local_seq), [1, 2]);
  assert.equal(Object.keys(world.events).length, 0);

  phone.online = true;
  phone.dropNextReply = true;
  assert.equal(flushDevice(world, phone).stopped, 'reply_lost');
  assert.equal(phone.outbox.length, 2, 'the unanswered write stays first');
  assert.equal(set(0).status, 'completed', 'the server did commit it');

  assert.equal(flushDevice(world, phone).stopped, null);
  assert.equal(phone.outbox.length, 0);
  assert.equal(Object.keys(world.events).length, 2, 'no duplicate event');
  assert.equal(set(0).revision, 1, 'no duplicate write');
  assert.ok(phone.history.some((entry) => entry.text.includes('replayed')));
});

test('group session routes: replay by id, limits, ownership and revision checks', () => {
  const { world } = fixture();
  const body = { id: 'g1', session_date: '2027-02-06', participant_ids: ['client_juno', 'client_ezra'] };
  assert.equal(createGroupSession(world, COACH, body).status, 201);
  assert.equal(createGroupSession(world, COACH, body).body.outcome, 'replayed');
  assert.equal(createGroupSession(world, REPLAY_OTHER_COACH.id, { ...body, id: 'g2' }).status, 404);
  assert.equal(createGroupSession(world, COACH, { ...body, id: 'g3', participant_ids: REPLAY_CLIENTS.map((row) => row.id) }).status, 201, '12 is the maximum');
  assert.equal(createGroupSession(world, COACH, { ...body, id: 'g4', participant_ids: [...REPLAY_CLIENTS.map((row) => row.id), 'client_thirteenth'] }).status, 400, '13 is refused');
  assert.equal(groupOverview(world, REPLAY_OTHER_COACH.id, 'g1').status, 404);

  assert.equal(patchGroupSession(world, COACH, 'g1', { base_revision: 0, participant_ids: ['client_juno', 'client_ezra', 'client_noor'] }).status, 200);
  const lost = patchGroupSession(world, COACH, 'g1', { base_revision: 0, participant_ids: ['client_juno'] });
  assert.equal(lost.status, 409);
  assert.equal(lost.body.session.revision, 1);
  assert.equal(world.sessions.g1.participants.filter((row) => !row.left_at).length, 3);
});

test('overview counts come from each participant’s own log', () => {
  const { world, set } = fixture();
  createGroupSession(world, COACH, { id: 'g1', session_date: '2027-02-06', participant_ids: ['client_juno', 'client_ezra'] });
  applySetEvent(world, { set_id: set(0).id, event_id: 'juno:e1', actor_role: 'client', base_revision: 0, payload: done(5) });
  const { participants, server_time: serverTime } = groupOverview(world, COACH, 'g1').body;
  assert.equal(participants[0].log.done, 1);
  assert.equal(participants[0].log.total, 3);
  assert.equal(participants[0].log.last_actor_role, 'client');
  assert.equal(participants[1].log, null);
  assert.equal(serverTime, new Date(START).toISOString());
});

test('notice reads are idempotent and coach-scoped', () => {
  const { world, set } = fixture();
  applySetEvent(world, { set_id: set(0).id, event_id: 'coach:e1', actor_role: 'coach', actor_coach_id: COACH, base_revision: 0, payload: done(5) });
  applySetEvent(world, { set_id: set(0).id, event_id: 'juno:e1', actor_role: 'client', base_revision: 0, payload: done(4) });
  const [notice] = listNotices(world, COACH).body.notices;
  assert.equal(listNotices(world, REPLAY_OTHER_COACH.id).body.notices.length, 0);
  assert.equal(markNoticeRead(world, REPLAY_OTHER_COACH.id, notice.id).body.already_read, true);
  assert.equal(listNotices(world, COACH).body.notices.length, 1, 'another coach cannot read it away');
  assert.ok(markNoticeRead(world, COACH, notice.id).body.read_at);
  assert.equal(markNoticeRead(world, COACH, notice.id).body.already_read, true);
  assert.equal(listNotices(world, COACH).body.notices.length, 0);
});

test('every replay rebuilds deterministically, step by step', () => {
  for (const scenario of REPLAY_SCENARIOS) {
    for (let step = 0; step < scenario.steps.length; step += 1) {
      const a = replayAt(scenario.id, step);
      const b = replayAt(scenario.id, step);
      assert.deepEqual(a.overview, b.overview, `${scenario.id} step ${step}`);
      assert.deepEqual(a.notices, b.notices);
    }
  }
});

test('late arrivals: 12 fictional participants, pace measured from each arrival', () => {
  const replay = replayAt('late');
  assert.equal(replay.overview.participants.length, 12);
  const roster = buildRoster({ session: replay.session, overview: replay.overview });
  const lark = roster.rows.find((row) => row.clientId === 'client_lark');
  assert.equal(classifyHeat(lark, roster.serverNowMs), 'on_pace');
  const sessionStart = Date.parse(replay.session.created_at);
  assert.equal(classifyHeat({ ...lark, joinedAtMs: sessionStart }, roster.serverNowMs), 'behind', 'measured from the session start, Lark would look behind');
  assert.equal(classifyHeat(roster.rows.find((row) => row.clientId === 'client_quinn'), roster.serverNowMs), 'done');

  const items = attentionItems({ rows: roster.rows, serverNowMs: roster.serverNowMs, notices: replay.notices.notices });
  assert.deepEqual(items.slice(0, 2).map((item) => [item.clientId, item.kind]), [['client_sol', 'conflict'], ['client_pell', 'swap_waiting']]);
  assert.equal(items[0].noticeIds.length, 1, 'the conflict notice is folded into the conflict item');
  assert.ok(items.some((item) => item.clientId === 'client_ari' && item.kind === 'idle'));
});

test('device drops mid-set: no double count, the differing value is kept for the coach', () => {
  const replay = replayAt('drop');
  const pell = replay.overview.participants.find((row) => row.client_id === 'client_pell');
  assert.equal(pell.log.done, 5);
  assert.equal(pell.log.open_conflicts, 1);
  const phone = replay.devices.find((device) => device.id === 'pell_phone');
  assert.equal(phone.outbox.length, 0);
  assert.ok(phone.history.some((entry) => entry.text.startsWith('pell_phone:e3 → replayed')));
  const offlineSet = replay.events.find((event) => event.id === 'pell_phone:e3');
  assert.equal(offlineSet.outcome, 'applied');
  assert.equal(offlineSet.offline, true);
  assert.equal(replay.events.filter((event) => event.set_id === offlineSet.set_id).length, 1);
  assert.equal(replay.events.find((event) => event.id === 'pell_phone:e4').outcome, 'conflict');
});

test('two devices disagree on time: the server order decides, the board reads server time', () => {
  const replay = replayAt('skew');
  const phoneWrite = replay.events.find((event) => event.id === 'quinn_phone:e3');
  const tabletWrite = replay.events.find((event) => event.id === 'quinn_tablet:e1');
  assert.equal(phoneWrite.set_id, tabletWrite.set_id);
  assert.equal(tabletWrite.outcome, 'applied');
  assert.ok(Date.parse(tabletWrite.created_at) > Date.parse(phoneWrite.created_at));
  const tablet = replay.devices.find((device) => device.id === 'quinn_tablet');
  const phone = replay.devices.find((device) => device.id === 'quinn_phone');
  assert.ok(tablet.history[0].deviceMs < phone.history.find((entry) => entry.text.includes('e3')).deviceMs, 'by device clocks the tablet looks earlier');
  const quinn = replay.overview.participants.find((row) => row.client_id === 'client_quinn');
  assert.equal(quinn.log.open_conflicts, 0);

  const roster = buildRoster({ session: replay.session, overview: replay.overview });
  const items = attentionItems({ rows: roster.rows, serverNowMs: roster.serverNowMs, notices: [] });
  const lio = items.find((item) => item.clientId === 'client_lio');
  assert.equal(lio.kind, 'idle');
  assert.match(lio.reason, /15 min/);
  // The coach laptop runs 10 minutes slow; nothing on the board depends on it.
  assert.equal(replay.devices.find((device) => device.id === 'coach_laptop').skewMs, -600_000);
});

// ---------- Set value origin mirror (local migration 20261113000000) ----------
// Only rows that carry value_origin (the migrated schema) are given origins;
// the mirror's own fixtures do not, and stay exactly as before.
function originFixture() {
  const f = fixture();
  for (const row of f.log.exercises[0].sets) Object.assign(row, { actual_load_value: 80, actual_load_unit: 'kg', value_origin: 'legacy', value_origin_nonce: null, prefill_load_value: null, prefill_load_unit: null });
  return f;
}
const qc = { status: 'completed', actual_load_value: null, actual_load_unit: null, actual_reps: null };
const undo80 = { status: 'pending', actual_load_value: 80, actual_load_unit: 'kg', actual_reps: null };

test('origin mirror: quick complete captures the snapshot; a matching Undo restores prefill', () => {
  const { world, set } = originFixture();
  applySetEvent(world, { set_id: set(0).id, event_id: 'o:1', actor_role: 'client', base_revision: 0, payload: qc, value_origin: 'entered' });
  assert.deepEqual([set(0).value_origin, set(0).prefill_load_value, set(0).prefill_load_unit, set(0).value_origin_nonce], ['entered', 80, 'kg', 'o:1']);
  const undone = applySetEvent(world, { set_id: set(0).id, event_id: 'o:2', actor_role: 'client', base_revision: 1, payload: undo80, value_origin: 'prefill' });
  assert.equal(undone.body.value_origin, 'prefill');
  assert.equal(world.events['o:2'].declared_origin, 'prefill');
  const replay = applySetEvent(world, { set_id: set(0).id, event_id: 'o:2', actor_role: 'client', base_revision: 1, payload: undo80, value_origin: 'prefill' });
  assert.deepEqual([replay.body.event.outcome, replay.body.value_origin, set(0).revision], ['replayed', 'prefill', 2]);
});

test('origin mirror: mismatch, missing snapshot and undeclared writes are unknown; explicit same value is entered', () => {
  const { world, set } = originFixture();
  applySetEvent(world, { set_id: set(0).id, event_id: 'o:3', actor_role: 'client', base_revision: 0, payload: qc, value_origin: 'entered' });
  applySetEvent(world, { set_id: set(0).id, event_id: 'o:4', actor_role: 'client', base_revision: 1, payload: { ...undo80, actual_load_value: 85 }, value_origin: 'prefill' });
  assert.deepEqual([set(0).value_origin, set(0).actual_load_value, set(0).prefill_load_value], ['unknown', 85, null]);
  applySetEvent(world, { set_id: set(1).id, event_id: 'o:5', actor_role: 'client', base_revision: 0, payload: { actual_load_value: 80, actual_load_unit: 'kg' } });
  assert.equal(set(1).value_origin, 'unknown', 'undeclared (old writer)');
  applySetEvent(world, { set_id: set(1).id, event_id: 'o:6', actor_role: 'client', base_revision: 1, payload: qc, value_origin: 'entered' });
  applySetEvent(world, { set_id: set(1).id, event_id: 'o:7', actor_role: 'client', base_revision: 2, payload: undo80, value_origin: 'prefill' });
  assert.equal(set(1).value_origin, 'unknown', 'no snapshot: the set was not untouched when completed');
  applySetEvent(world, { set_id: set(2).id, event_id: 'o:8', actor_role: 'client', base_revision: 0, payload: { actual_load_value: 80, actual_load_unit: 'kg' }, value_origin: 'entered' });
  assert.equal(set(2).value_origin, 'entered', 'finding 01 on the new schema');
  assert.equal(applySetEvent(world, { set_id: set(2).id, event_id: 'o:9', actor_role: 'client', base_revision: 1, payload: {}, value_origin: 'unknown' }).status, 400);
});

test('origin mirror: a conflict keeps the origin; a coach resolution leaves the set unknown', () => {
  const { world, set } = originFixture();
  applySetEvent(world, { set_id: set(0).id, event_id: 'o:10', actor_role: 'client', base_revision: 0, payload: { actual_load_value: 82.5, actual_load_unit: 'kg' }, value_origin: 'entered' });
  const late = applySetEvent(world, { set_id: set(0).id, event_id: 'o:11', actor_role: 'coach', actor_coach_id: COACH, base_revision: 0, payload: { actual_load_value: 90, actual_load_unit: 'kg' }, value_origin: 'entered' });
  assert.equal(late.body.event.outcome, 'conflict');
  assert.equal(set(0).value_origin, 'entered');
  resolveConflict(world, COACH, late.body.event.conflict_id, 'incoming');
  assert.deepEqual([set(0).value_origin, set(0).actual_load_value], ['unknown', 90]);
});

test('origin mirror: rows without the column never gain one', () => {
  const { world, set } = fixture();
  applySetEvent(world, { set_id: set(0).id, event_id: 'o:12', actor_role: 'client', base_revision: 0, payload: done(5), value_origin: 'entered' });
  assert.equal(Object.hasOwn(set(0), 'value_origin'), false);
});
