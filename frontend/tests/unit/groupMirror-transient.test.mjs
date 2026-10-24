// PR121 review (discussion r4368525315): the coach-account mirror of a station
// session after transient failures and uncertain commits. One set of
// scenarios, run against either implementation:
//   default                     src/lib/groupMirror.js (the corrected helper)
//   MIRROR_BASE_SOURCE=<file>   the exact sendMirror/pushMirror callbacks of a
//                               GroupSession.jsx revision (used for BASE RED)
// A controlled clock drives the debounce and any retries; a controlled API in
// front of the committed synthetic group server can hold a reply, lose it
// after the write committed, fail before the write, or answer 5xx/4xx. No
// React, browser or network. Fictional data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as model from '../../src/lib/groupSession.js';
import { TRAINEES, createGroupServer } from '../browser/fixtures/groupSessionServer.mjs';

const clone = (value) => JSON.parse(JSON.stringify(value));
const settle = async () => { for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

function fakeClock() {
  let now = 0;
  let next = 0;
  const timers = new Map();
  return {
    timers,
    setTimeout(fn, ms) { next += 1; timers.set(next, { at: now + ms, fn }); return next; },
    clearTimeout(id) { timers.delete(id); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        await settle();
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
      await settle();
    },
  };
}

// Per-request outcomes, in order; anything not planned is answered normally.
function controlledApi(server) {
  const plan = [];
  const log = [];
  const networkError = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
  const statusError = (status) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data: { error: 'Synthetic' } } });
  function call(method, path, body) {
    const step = plan.shift() || { mode: 'ok' };
    const entry = { method, path, body: clone(body), mode: step.mode };
    log.push(entry);
    const apply = () => server.request(method, path, body);
    if (step.mode === 'network') return Promise.reject(networkError()); // never reached the server
    if (step.mode === 'status') return Promise.reject(statusError(step.status));
    if (step.mode === 'commit-lost') { apply(); return Promise.reject(networkError()); }
    if (step.mode === 'stale-conflict') {
      // backend/src/routes/conductor.js groups.patch reads the session first,
      // then updates conditionally; a commit in between makes it answer 409
      // with the copy it read before that commit.
      const id = path.split('/').at(-1);
      const before = clone(server.db.groups.find((g) => g.id === id));
      step.otherDevice(server.db.groups.find((g) => g.id === id));
      return Promise.reject(Object.assign(new Error('HTTP 409'), { response: { status: 409, data: { error: 'This session changed on another device.', session: before } } }));
    }
    if (step.mode === 'held') {
      return new Promise((resolve, reject) => {
        step.ok = () => { try { resolve({ data: apply() }); } catch (error) { reject(error); } };
        step.network = () => reject(networkError());
        step.status = (status) => reject(statusError(status));
        step.commitLost = () => { apply(); reject(networkError()); };
      });
    }
    try { return Promise.resolve({ data: apply() }); } catch (error) { return Promise.reject(error); }
  }
  return { api: { post: (p, b) => call('POST', p, b), patch: (p, b) => call('PATCH', p, b) }, plan, log };
}

// The device side: session ref, state indicator, adoption (existing policy:
// keepUnsyncedWork) and the mirror implementation under test.
async function device({ session, revision, server, clock, api }) {
  const sessionRef = { current: session };
  const states = [];
  const stored = [];
  const adoptRemote = (remote) => {
    const adopted = model.keepUnsyncedWork(remote, sessionRef.current);
    sessionRef.current = adopted;
    stored.push(adopted);
    return adopted;
  };
  let push;
  let fresh;
  const mirror = { current: null };
  const basePath = process.env.MIRROR_BASE_SOURCE;
  if (basePath) {
    const source = readFileSync(basePath, 'utf8');
    const extract = (marker) => {
      const at = source.indexOf(marker);
      assert.ok(at >= 0, `missing ${marker}`);
      const start = at + marker.length;
      const end = source.indexOf('\n  }, [', start);
      return source.slice(start, end);
    };
    const freshSource = source.match(/^const freshMirror = (.*);$/m)[1];
    fresh = new Function(`return ${freshSource}`)();
    const sendBody = extract('const sendMirror = useCallback(async () => {');
    const pushBody = extract('const pushMirror = useCallback(() => {');
    const sendMirror = new Function('mirror', 'sessionRef', 'api', 'window', 'setMirrorState', 'sameSessionState', 'keepUnsyncedWork', 'saveGroupSession', 'localStorage', 'scope', 'setSession',
      `return async function sendMirror(){${sendBody}\n}`)(mirror, sessionRef, api, clock, (s) => states.push(s), model.sameSessionState,
      (remote) => adoptRemote(remote), () => {}, {}, {}, () => {});
    push = new Function('mirror', 'sessionRef', 'window', 'freshMirror', 'sendMirror', `return function pushMirror(){${pushBody}\n}`)(mirror, sessionRef, clock, fresh, sendMirror);
  } else {
    const helper = await import('../../src/lib/groupMirror.js');
    fresh = (id, rev = null) => helper.createMirrorState(id, rev);
    const ctx = { mirror, sessionRef, api, clock, onState: (s) => states.push(s), adopt: adoptRemote };
    push = () => helper.scheduleMirror(ctx);
  }
  mirror.current = fresh(session.id, revision);
  return {
    sessionRef, mirror, states, stored,
    edit(update) { sessionRef.current = update(sessionRef.current); push(); },
    replaceSession(next) {
      // As GroupSession's discard + start: cancel the owned timer, fresh mirror, new session.
      clock.clearTimeout(mirror.current.timer);
      mirror.current = fresh(null);
      sessionRef.current = next;
      push();
    },
    server,
  };
}

const STATIONS = [
  { exercise_library_id: 'fict-lib-goblet', name: 'Goblet Squat', sets: '2', reps: '10', default_load_value: '35' },
  { exercise_library_id: 'fict-lib-row', name: 'Cable Row', sets: '2', reps: '10', default_load_value: '35' },
];
const newSession = (id) => model.createGroupSession({ id, environment: 'test', coachId: 'fict-coach-g1', date: '2026-10-24', title: 'Plan v0', trainees: TRAINEES.slice(0, 2), stations: STATIONS });
const createBody = (session) => ({ id: session.id, title: session.title, mode: 'stations', participant_ids: [TRAINEES[0].id, TRAINEES[1].id], station_state: session });
const retitle = (title) => (s) => ({ ...s, title });
// A plan-only amendment: no entered sets, so pending-set merging cannot mask a wrong adoption.
const amend = (s) => model.amendStation(s, { id: '00000000-0000-4000-8000-0000000000a9', stationId: s.stations[1].id, exercise: { exercise_library_id: 'fict-lib-dbbench', name: 'DB Bench Press', sets: '2', reps: '8' }, reason: 'Cable busy' });

async function synced(id = '00000000-0000-4000-8000-0000000000a1') {
  const server = createGroupServer();
  const session = newSession(id);
  server.request('POST', '/group-sessions', createBody(session)); // already created, revision 0
  const clock = fakeClock();
  const controlled = controlledApi(server);
  const d = await device({ session, revision: 0, server, clock, api: controlled.api });
  return { ...d, clock, ...controlled };
}
const row = (server, id) => server.db.groups.find((g) => g.id === id);

for (const failure of ['network', '503']) {
  test(`${failure} while a newer plan is queued: the newer plan reaches the account without another edit or reload`, async () => {
    const t = await synced();
    const held = { mode: 'held' };
    t.plan.push(held);
    t.edit(retitle('Plan A'));
    await t.clock.advance(600);
    assert.equal(t.log.length, 1, 'A is in flight');
    t.edit(retitle('Plan B'));
    await t.clock.advance(600); // B's debounce fires while A is in flight
    if (failure === 'network') held.network(); else held.status(503);
    await t.clock.advance(5 * 60 * 1000);
    assert.equal(row(t.server, t.sessionRef.current.id).station_state.title, 'Plan B', JSON.stringify(t.log.map((l) => [l.method, l.mode, l.body.station_state?.title])));
    assert.equal(t.sessionRef.current.title, 'Plan B');
    assert.equal(t.states.at(-1), 'saved');
    assert.ok(t.log.length <= 4, `bounded: ${t.log.length} requests`);
    assert.equal(t.clock.timers.size, 0, 'nothing left scheduled');
  });
}

test('A committed but its reply was lost, plan-only B queued: B is kept and mirrored from the confirmed revision, no adoption, no extra commit', async () => {
  const t = await synced();
  const held = { mode: 'held' };
  t.plan.push(held);
  t.edit(retitle('Plan A'));
  await t.clock.advance(600);
  t.edit((s) => amend(retitle('Plan B')(s)));
  await t.clock.advance(600);
  held.commitLost(); // the server has A (revision 1); this device does not know
  await t.clock.advance(5 * 60 * 1000);
  const server = row(t.server, t.sessionRef.current.id);
  assert.equal(server.station_state.title, 'Plan B');
  assert.equal(server.station_state.amendments.length, 1, 'the plan-only amendment is mirrored');
  assert.equal(t.sessionRef.current.title, 'Plan B', 'this device kept B');
  assert.equal(t.sessionRef.current.amendments.length, 1);
  assert.ok(!t.states.includes('replaced'), 'its own lost commit is not treated as another device');
  assert.equal(server.revision, 2, 'exactly two commits: A, then B');
  assert.equal(t.states.at(-1), 'saved');
});

test('A committed with its reply lost, then another plan-only edit: never adopts its own old copy', async () => {
  const t = await synced();
  t.plan.push({ mode: 'commit-lost' });
  t.edit(retitle('Plan A'));
  await t.clock.advance(600);
  t.edit((s) => amend(retitle('Plan E')(s)));
  await t.clock.advance(5 * 60 * 1000);
  const server = row(t.server, t.sessionRef.current.id);
  assert.equal(t.sessionRef.current.title, 'Plan E', 'this device kept its newest plan');
  assert.equal(t.sessionRef.current.amendments.length, 1);
  assert.equal(server.station_state.title, 'Plan E');
  assert.ok(!t.states.includes('replaced'));
  assert.equal(t.states.at(-1), 'saved');
});

test('lost create reply with a newer plan queued: one group record, then the newer plan', async () => {
  const server = createGroupServer();
  const session = newSession('00000000-0000-4000-8000-0000000000a2');
  const clock = fakeClock();
  const c = controlledApi(server);
  const t = await device({ session, revision: null, server, clock, api: c.api });
  const held = { mode: 'held' };
  c.plan.push(held);
  t.edit((s) => s); // the session's first mirror: a create
  await clock.advance(600);
  assert.deepEqual(c.log.map((l) => l.method), ['POST']);
  t.edit(retitle('Plan B'));
  await clock.advance(600);
  held.commitLost(); // created on the server; reply lost
  await clock.advance(5 * 60 * 1000);
  assert.equal(server.db.groups.length, 1, 'one group record');
  assert.equal(server.db.groups[0].station_state.title, 'Plan B');
  assert.equal(t.states.at(-1), 'saved');
});

test('lost create reply, then another device changed the plan before the retry: its change is adopted, never overwritten', async () => {
  for (const withPending of [false, true]) {
    const server = createGroupServer();
    const session = newSession('00000000-0000-4000-8000-0000000000a5');
    const clock = fakeClock();
    const c = controlledApi(server);
    const t = await device({ session, revision: null, server, clock, api: c.api });
    c.plan.push({ mode: 'commit-lost' }); // A: created on the server, reply lost
    t.edit((s) => s);
    await clock.advance(600);
    assert.equal(server.db.groups.length, 1);
    // Another coach device (which resumed the session) changes it: C.
    const g = server.db.groups[0];
    Object.assign(g, { station_state: { ...g.station_state, title: 'Plan C (other device)' }, revision: g.revision + 1 });
    let key = null;
    t.edit((s) => {
      let next = amend(retitle('Plan B')(s)); // plan-only B on this device
      if (withPending) {
        next = model.openVisit(next, { round: 0, slotIndex: 0, traineeId: TRAINEES[0].id, requestId: '00000000-0000-4000-8000-0000000000b8' });
        key = model.getVisit(next, 0, 0, TRAINEES[0].id).key;
        next = model.recordEntry(next, key, 'p1', { reps: 9, load: 35 });
        next = model.updateVisitSet(next, key, 'p1', (set) => ({ ...set, state: 'failed', eventId: 'event-kept-2', setId: 'set-kept-2' }));
      }
      return next;
    });
    await clock.advance(5 * 60 * 1000);
    assert.equal(server.db.groups.length, 1, 'still one group record');
    assert.equal(server.db.groups[0].station_state.title, 'Plan C (other device)', `${withPending}: C is not overwritten`);
    assert.equal(t.sessionRef.current.title, 'Plan C (other device)', `${withPending}: this device adopts C`);
    assert.ok(t.states.includes('replaced'));
    if (withPending) {
      const kept = t.sessionRef.current.visits[key].sets.find((x) => x.key === 'p1');
      assert.deepEqual([kept.entry.reps, kept.eventId, kept.setId], [9, 'event-kept-2', 'set-kept-2'], 'unsaved entry kept with its ids');
      assert.equal(server.db.groups[0].station_state.visits[key].sets.find((x) => x.key === 'p1').eventId, 'event-kept-2', 'and mirrored on top of C');
    }
  }
});

test('a conflict answer carrying a stale copy (read before another device\'s commit) is never adopted; the current copy is', async () => {
  for (const withPending of [false, true]) {
    const t = await synced('00000000-0000-4000-8000-0000000000a6');
    let key = null;
    if (withPending) {
      let s = model.openVisit(t.sessionRef.current, { round: 0, slotIndex: 0, traineeId: TRAINEES[0].id, requestId: '00000000-0000-4000-8000-0000000000b7' });
      key = model.getVisit(s, 0, 0, TRAINEES[0].id).key;
      s = model.recordEntry(s, key, 'p1', { reps: 8, load: 35 });
      s = model.updateVisitSet(s, key, 'p1', (set) => ({ ...set, state: 'failed', eventId: 'event-kept-3', setId: 'set-kept-3' }));
      t.sessionRef.current = s;
    }
    // While this device's update is checked, another device commits C; the answer carries S0.
    t.plan.push({ mode: 'stale-conflict', otherDevice: (g) => Object.assign(g, { station_state: { ...g.station_state, title: 'Plan C (other device)' }, revision: g.revision + 1 }) });
    t.edit(retitle('Plan B'));
    await t.clock.advance(5 * 60 * 1000);
    const server = row(t.server, '00000000-0000-4000-8000-0000000000a6');
    assert.equal(t.sessionRef.current.title, 'Plan C (other device)', `${withPending}: adopts the current copy, not the stale one`);
    assert.ok(!t.stored.some((x) => x.title === 'Plan v0'), `${withPending}: the stale copy was never adopted`);
    assert.equal(server.station_state.title, 'Plan C (other device)', `${withPending}: C kept on the account`);
    if (withPending) {
      const kept = t.sessionRef.current.visits[key].sets.find((x) => x.key === 'p1');
      assert.deepEqual([kept.entry.reps, kept.eventId, kept.setId], [8, 'event-kept-3', 'set-kept-3']);
      assert.equal(server.station_state.visits[key].sets.find((x) => x.key === 'p1').eventId, 'event-kept-3');
    }
  }
});

test('a genuine change from another device is adopted, keeping this device\'s unsaved entry and its ids', async () => {
  const t = await synced();
  let s = model.openVisit(t.sessionRef.current, { round: 0, slotIndex: 0, traineeId: TRAINEES[0].id, requestId: '00000000-0000-4000-8000-0000000000b9' });
  const key = model.getVisit(s, 0, 0, TRAINEES[0].id).key;
  s = model.recordEntry(s, key, 'p1', { reps: 7, load: 35 });
  s = model.updateVisitSet(s, key, 'p1', (set) => ({ ...set, state: 'failed', eventId: 'event-kept-1', setId: 'set-kept-1' }));
  t.sessionRef.current = s;
  // Another device renames the plan on the server.
  const g = row(t.server, s.id);
  Object.assign(g, { station_state: { ...g.station_state, title: 'Plan C (other device)' }, revision: g.revision + 1 });
  t.edit(retitle('Plan B'));
  await t.clock.advance(5 * 60 * 1000);
  assert.equal(t.sessionRef.current.title, 'Plan C (other device)', 'other device adopted');
  const kept = t.sessionRef.current.visits[key].sets.find((x) => x.key === 'p1');
  assert.deepEqual([kept.entry.reps, kept.eventId, kept.setId, kept.state], [7, 'event-kept-1', 'set-kept-1', 'failed']);
  assert.ok(t.states.includes('replaced'));
  const server = row(t.server, s.id);
  assert.equal(server.station_state.title, 'Plan C (other device)');
  assert.equal(server.station_state.visits[key].sets.find((x) => x.key === 'p1').eventId, 'event-kept-1', 'kept entry mirrored on top');
});

test('repeated transient failure: retries back off and stop after a bounded number; never a tight loop', async () => {
  const t = await synced();
  for (let i = 0; i < 50; i += 1) t.plan.push({ mode: 'network' });
  t.edit(retitle('Plan A'));
  await t.clock.advance(600);
  await t.clock.advance(60 * 60 * 1000);
  const sends = t.log.length;
  assert.ok(sends >= 3, `it keeps trying on its own (${sends})`);
  assert.ok(sends <= 11, `bounded (${sends})`);
  assert.equal(t.clock.timers.size, 0, 'no timer left after giving up');
  assert.equal(t.states.at(-1), 'local', 'honest: only on this device');
  assert.equal(t.sessionRef.current.title, 'Plan A', 'local plan kept');
  // A later edit starts again.
  t.plan.length = 0;
  t.edit(retitle('Plan A2'));
  await t.clock.advance(10 * 60 * 1000);
  assert.equal(row(t.server, t.sessionRef.current.id).station_state.title, 'Plan A2');
});

for (const status of [400, 401, 403, 404]) {
  test(`terminal ${status}: no automatic retry loop, plan kept, shown as on this device`, async () => {
    const t = await synced();
    t.plan.push({ mode: 'status', status });
    t.edit(retitle('Plan A'));
    await t.clock.advance(30 * 60 * 1000);
    assert.equal(t.log.length, 1);
    assert.equal(t.states.at(-1), 'local');
    assert.equal(t.sessionRef.current.title, 'Plan A');
    assert.equal(t.clock.timers.size, 0);
  });
}

test('replaced session: the old request\'s failure or late reply schedules nothing and never touches the new session', async () => {
  for (const outcome of ['network', 'ok']) {
    const t = await synced('00000000-0000-4000-8000-0000000000a3');
    const held = { mode: 'held' };
    t.plan.push(held);
    t.edit(retitle('Old plan'));
    await t.clock.advance(600);
    const next = newSession('00000000-0000-4000-8000-0000000000a4');
    t.replaceSession(next);
    await t.clock.advance(600); // the new session is created
    if (outcome === 'network') held.network(); else held.ok();
    await t.clock.advance(5 * 60 * 1000);
    const forNew = t.log.filter((l) => l.path.includes(next.id) || l.body?.id === next.id);
    assert.deepEqual(forNew.map((l) => l.method), ['POST'], `${outcome}: only the new session's create`);
    assert.ok(!t.log.some((l) => l.method === 'PATCH' && l.path.endsWith(next.id)), 'no old revision sent to the new session');
    assert.equal(t.log.filter((l) => l.path.endsWith('0000000000a3')).length, 1, `${outcome}: the old session is not retried`);
    assert.equal(t.mirror.current.sessionId, next.id);
    assert.equal(t.states.at(-1), 'saved');
    assert.equal(t.clock.timers.size, 0);
  }
});

test('five-reply drain still delivers the newest plan without another edit', async () => {
  const t = await synced();
  const holds = [];
  for (let i = 0; i < 5; i += 1) { const h = { mode: 'held' }; holds.push(h); t.plan.push(h); }
  t.edit(retitle('Plan 0'));
  await t.clock.advance(600);
  for (let i = 1; i <= 5; i += 1) {
    t.edit(retitle(`Plan ${i}`));
    await t.clock.advance(700);
    holds[i - 1].ok();
    await t.clock.advance(1);
  }
  await t.clock.advance(5 * 60 * 1000);
  assert.equal(row(t.server, t.sessionRef.current.id).station_state.title, 'Plan 5');
  assert.equal(t.states.at(-1), 'saved');
});
