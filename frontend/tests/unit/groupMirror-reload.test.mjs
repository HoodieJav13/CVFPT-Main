// Station-session mirror across an actual unmount/reload (follow-up to the
// PR121 transient-recovery repair). A page "mount" does what GroupSession
// does: load the stored session (and, where the version has it, its stored
// mirror bookkeeping), build the mirror state, and save the session on every
// change. Storage is a real Storage-like object, so what survives a reload is
// exactly what was written. Actual model, store, mirror and the committed
// synthetic group server; fictional data; controlled clock and replies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../../src/lib/groupSession.js';
import * as store from '../../src/lib/groupSessionStore.js';
import * as helper from '../../src/lib/groupMirror.js';
import { TRAINEES, createGroupServer } from '../browser/fixtures/groupSessionServer.mjs';

const SCOPE = { environment: 'test', coachId: 'fict-coach-g1' };
const clone = (value) => JSON.parse(JSON.stringify(value));
const settle = async () => { for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

function memoryStorage() {
  const map = new Map();
  return {
    map, deny: false,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem(k, v) { if (this.deny) throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' }); map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}
function fakeClock() {
  let now = 0; let next = 0; const timers = new Map();
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
        timers.delete(due[0]); now = due[1].at; due[1].fn();
      }
      now = end; await settle();
    },
  };
}
function controlledApi(server) {
  const plan = []; const log = [];
  const networkError = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
  function call(method, path, body) {
    const step = plan.shift() || { mode: 'ok' };
    log.push({ method, path, body: clone(body), mode: step.mode });
    if (step.mode === 'network') return Promise.reject(networkError());
    if (step.mode === 'commit-lost') { server.request(method, path, body); return Promise.reject(networkError()); }
    if (step.mode === 'held') {
      return new Promise((resolve, reject) => {
        step.ok = () => { try { resolve({ data: server.request(method, path, body) }); } catch (error) { reject(error); } };
        step.network = () => reject(networkError());
      });
    }
    try { return Promise.resolve({ data: server.request(method, path, body) }); } catch (error) { return Promise.reject(error); }
  }
  return { api: { post: (p, b) => call('POST', p, b), patch: (p, b) => call('PATCH', p, b) }, plan, log };
}

const STATIONS = [
  { exercise_library_id: 'fict-lib-goblet', name: 'Goblet Squat', sets: '2', reps: '8' },
  { exercise_library_id: 'fict-lib-row', name: 'Cable Row', sets: '2', reps: '8' },
];
const newSession = (id) => model.createGroupSession({ id, environment: SCOPE.environment, coachId: SCOPE.coachId, date: '2026-10-24', title: 'Plan A', trainees: TRAINEES.slice(0, 2), stations: STATIONS });
// The ordinary equipment amendment from the finding.
const amendCableRow = (s) => model.amendStation(s, { id: '00000000-0000-4000-8000-0000000000a9', stationId: s.stations[1].id, exercise: { exercise_library_id: 'fict-lib-dbbench', name: 'DB Bench Press', sets: '2', reps: '8' }, reason: 'Cable busy' });
const retitle = (title) => (s) => ({ ...s, title });

// One page mount, as GroupSession does it at this source revision.
function mountPage({ storage, api, clock }) {
  const sessionRef = { current: store.loadGroupSession(storage, SCOPE) };
  const meta = typeof store.loadMirrorMeta === 'function' && sessionRef.current ? store.loadMirrorMeta(storage, SCOPE, sessionRef.current) : null;
  const mirror = { current: typeof helper.restoreMirrorState === 'function' && sessionRef.current ? helper.restoreMirrorState(sessionRef.current, meta) : helper.createMirrorState(null) };
  const states = [];
  const storageResults = [];
  const metaOf = () => (typeof helper.mirrorMeta === 'function' ? helper.mirrorMeta(mirror.current) : undefined);
  const save = (session) => { const ok = store.saveGroupSession(storage, SCOPE, session, metaOf()); storageResults.push(ok); return ok; };
  const ctx = {
    mirror, sessionRef, api, clock,
    onState: (s) => states.push(s),
    onStored: (ok) => storageResults.push(ok),
    persist: () => save(sessionRef.current),
    adopt: (remote) => { const adopted = model.keepUnsyncedWork(remote, sessionRef.current); if (adopted) { sessionRef.current = adopted; save(adopted); } return adopted; },
  };
  const page = {
    sessionRef, mirror, states, storageResults, ctx,
    commit(update) { sessionRef.current = update(sessionRef.current); save(sessionRef.current); helper.scheduleMirror(ctx); },
    mountEffect() { if (sessionRef.current) helper.scheduleMirror(ctx); }, // the mount effect pushes the mirror
    // Only what the product itself does on unmount (GroupSession's effect
    // cleanup calls closeMirror); nothing invented by the harness.
    unmount() { if (typeof helper.closeMirror === 'function') helper.closeMirror(ctx); },
    discard() { store.clearGroupSession(storage, SCOPE); clock.clearTimeout(mirror.current.timer); mirror.current = helper.createMirrorState(null); sessionRef.current = null; },
    start(session) { page.commit(() => session); },
  };
  return page;
}

async function startedAndSynced(id = '00000000-0000-4000-8000-0000000000e1') {
  const storage = memoryStorage();
  const server = createGroupServer();
  const clock = fakeClock();
  const c = controlledApi(server);
  const page = mountPage({ storage, api: c.api, clock });
  page.start(newSession(id));
  await clock.advance(5000);
  assert.equal(server.db.groups.length, 1);
  assert.equal(page.states.at(-1), 'saved');
  return { storage, server, clock, c, page, id };
}
const account = (server, id) => server.db.groups.find((g) => g.id === id);
async function reload(t) {
  t.page.unmount();
  const page = mountPage({ storage: t.storage, api: t.c.api, clock: t.clock });
  page.mountEffect();
  await t.clock.advance(5 * 60 * 1000);
  return page;
}

test('ordinary equipment amendment made offline survives an actual reload and reaches the account', async () => {
  const t = await startedAndSynced();
  for (let i = 0; i < 20; i += 1) t.c.plan.push({ mode: 'network' });
  t.page.commit(amendCableRow);
  await t.clock.advance(1000); // its update gets no answer
  const before = clone(t.page.sessionRef.current.amendments);
  assert.equal(before.length, 1);
  t.c.plan.length = 0; // back online
  const page = await reload(t);
  assert.deepEqual(page.sessionRef.current.amendments, before, 'the amendment is still on this device');
  assert.deepEqual(account(t.server, t.id).station_state.amendments, before, 'and it reached the account');
  assert.ok(!page.states.includes('replaced'), 'not treated as another device');
  assert.equal(page.states.at(-1), 'saved');
  assert.ok(!('_mirror' in account(t.server, t.id).station_state), 'bookkeeping is never sent');
});

test('update committed with its reply lost, newer amendment, then reload: own commit confirmed, newest plan kept and mirrored once', async () => {
  const t = await startedAndSynced('00000000-0000-4000-8000-0000000000e2');
  t.c.plan.push({ mode: 'commit-lost' });
  t.page.commit(retitle('Plan A2'));
  await t.clock.advance(700); // A2 committed on the account; reply lost
  assert.equal(account(t.server, t.id).revision, 1);
  for (let i = 0; i < 20; i += 1) t.c.plan.push({ mode: 'network' });
  t.page.commit(amendCableRow); // B, still offline
  await t.clock.advance(1000);
  t.c.plan.length = 0;
  const page = await reload(t);
  assert.equal(page.sessionRef.current.title, 'Plan A2');
  assert.equal(page.sessionRef.current.amendments.length, 1, 'the newer amendment is kept');
  const acct = account(t.server, t.id);
  assert.equal(acct.station_state.amendments.length, 1);
  assert.equal(acct.revision, 2, 'A2 then B: no extra commit');
  assert.ok(!page.states.includes('replaced'));
  assert.equal(page.states.at(-1), 'saved');
});

test('another device\'s newer copy is not overwritten after a reload; unsaved entries keep their ids', async () => {
  const t = await startedAndSynced('00000000-0000-4000-8000-0000000000e3');
  for (let i = 0; i < 20; i += 1) t.c.plan.push({ mode: 'network' });
  let key = null;
  t.page.commit((s) => {
    let next = amendCableRow(s);
    next = model.openVisit(next, { round: 0, slotIndex: 0, traineeId: TRAINEES[0].id, requestId: '00000000-0000-4000-8000-0000000000c9' });
    key = model.getVisit(next, 0, 0, TRAINEES[0].id).key;
    next = model.recordEntry(next, key, 'p1', { reps: 6, load: 30 });
    return model.updateVisitSet(next, key, 'p1', (set) => ({ ...set, state: 'failed', eventId: 'event-kept-r3', setId: 'set-kept-r3' }));
  });
  await t.clock.advance(1000);
  // Meanwhile another coach device changed the plan on the account: C.
  const g = account(t.server, t.id);
  Object.assign(g, { station_state: { ...g.station_state, title: 'Plan C (other device)' }, revision: g.revision + 1 });
  t.c.plan.length = 0;
  const page = await reload(t);
  const acct = account(t.server, t.id);
  assert.equal(acct.station_state.title, 'Plan C (other device)', 'C is not overwritten');
  assert.equal(page.sessionRef.current.title, 'Plan C (other device)');
  const kept = page.sessionRef.current.visits[key].sets.find((x) => x.key === 'p1');
  assert.deepEqual([kept.entry.reps, kept.eventId, kept.setId], [6, 'event-kept-r3', 'set-kept-r3']);
  assert.equal(acct.station_state.visits[key].sets.find((x) => x.key === 'p1').eventId, 'event-kept-r3');
  assert.ok(page.states.includes('replaced'));
});

function legacyEntry(storage, session, extra = {}) {
  // As saved by a version without bookkeeping (or with bookkeeping that cannot be trusted).
  storage.map.set(store.groupSessionKey(SCOPE), JSON.stringify({ ...session, ...extra }));
}

test('legacy saved session (no bookkeeping) that differs from the account: both kept, an explicit choice resolves it', async () => {
  for (const choice of ['local', 'remote']) {
    const storage = memoryStorage();
    const server = createGroupServer();
    const clock = fakeClock();
    const c = controlledApi(server);
    const A = newSession(`00000000-0000-4000-8000-0000000000f${choice === 'local' ? 1 : 2}`);
    server.request('POST', '/group-sessions', { id: A.id, title: A.title, mode: 'stations', participant_ids: [TRAINEES[0].id, TRAINEES[1].id], station_state: A });
    legacyEntry(storage, amendCableRow(A));
    const page = mountPage({ storage, api: c.api, clock });
    page.mountEffect();
    await clock.advance(5 * 60 * 1000);
    assert.equal(page.sessionRef.current.amendments.length, 1, `${choice}: this device's copy is kept`);
    assert.equal(store.loadGroupSession(storage, SCOPE).amendments.length, 1, `${choice}: and stays stored`);
    assert.equal(account(server, A.id).station_state.amendments.length, 0, `${choice}: the account copy is not overwritten`);
    assert.equal(page.states.at(-1), 'diverged', `${choice}: the difference is shown, not hidden`);
    assert.equal(clock.timers.size, 0, 'nothing retried in a loop');
    // The explicit choice.
    await helper.resolveDivergence(page.ctx, choice);
    await clock.advance(5000);
    if (choice === 'local') {
      assert.equal(account(server, A.id).station_state.amendments.length, 1, 'sent as chosen');
      assert.equal(page.sessionRef.current.amendments.length, 1);
    } else {
      assert.equal(page.sessionRef.current.amendments.length, 0, 'the account copy is used, as chosen');
      assert.equal(account(server, A.id).station_state.amendments.length, 0);
    }
    assert.equal(page.states.at(-1), choice === 'local' ? 'saved' : 'replaced');
  }
});

test('legacy saved session equal to the account copy is simply confirmed', async () => {
  const storage = memoryStorage();
  const server = createGroupServer();
  const clock = fakeClock();
  const c = controlledApi(server);
  const A = newSession('00000000-0000-4000-8000-0000000000f3');
  server.request('POST', '/group-sessions', { id: A.id, title: A.title, mode: 'stations', participant_ids: [TRAINEES[0].id, TRAINEES[1].id], station_state: A });
  legacyEntry(storage, A);
  const page = mountPage({ storage, api: c.api, clock });
  page.mountEffect();
  await clock.advance(60 * 1000);
  assert.equal(page.states.at(-1), 'saved');
  assert.equal(account(server, A.id).revision, 0, 'no needless update');
});

test('bookkeeping that does not belong to this session, or is malformed, is refused (never trusted to overwrite)', async () => {
  for (const bad of [
    { v: 1, sessionId: 'another-session', revision: 5, unresolved: null },
    { v: 1, sessionId: null, revision: -1, unresolved: null },
    { v: 9, sessionId: 'x', revision: 'five' },
    'garbage',
  ]) {
    const storage = memoryStorage();
    const server = createGroupServer();
    const clock = fakeClock();
    const c = controlledApi(server);
    const A = newSession('00000000-0000-4000-8000-0000000000f4');
    // The account holds another device's copy C at revision 5.
    server.request('POST', '/group-sessions', { id: A.id, title: 'Plan C (other device)', mode: 'stations', participant_ids: [TRAINEES[0].id], station_state: { ...A, title: 'Plan C (other device)' } });
    Object.assign(server.db.groups[0], { revision: 5 });
    const local = amendCableRow(A);
    legacyEntry(storage, local, { _mirror: bad === 'garbage' ? bad : { ...bad, sessionId: bad.sessionId === 'x' ? A.id : bad.sessionId } });
    const page = mountPage({ storage, api: c.api, clock });
    page.mountEffect();
    await clock.advance(5 * 60 * 1000);
    assert.equal(account(server, A.id).station_state.title, 'Plan C (other device)', `${JSON.stringify(bad)}: C not overwritten`);
    assert.equal(page.sessionRef.current.amendments.length, 1, `${JSON.stringify(bad)}: local copy kept`);
    assert.ok(!('_mirror' in page.sessionRef.current), 'bookkeeping never enters the session');
  }
});

test('a refused storage write: the update is not sent and "saved" is never claimed until it can be stored', async () => {
  const t = await startedAndSynced('00000000-0000-4000-8000-0000000000e5');
  const sent = t.c.log.length;
  t.storage.deny = true;
  t.page.commit(amendCableRow);
  await t.clock.advance(10 * 1000);
  assert.equal(t.c.log.length, sent, 'no update without its stored bookkeeping');
  assert.ok(!t.page.states.slice(1).includes('saved'), 'no false "saved"');
  assert.equal(t.page.states.at(-1), 'local');
  assert.ok(t.page.storageResults.includes(false), 'the refusal is reported');
  t.storage.deny = false;
  await t.clock.advance(5 * 60 * 1000);
  assert.equal(account(t.server, t.id).station_state.amendments.length, 1, 'sent once storage works again');
  assert.equal(t.page.states.at(-1), 'saved');
});

test('a replaced session starts clean, and a held late answer for the old session changes neither memory nor storage', async () => {
  for (const outcome of ['ok', 'network']) {
    const t = await startedAndSynced(`00000000-0000-4000-8000-0000000000e${outcome === 'ok' ? 6 : 8}`);
    const held = { mode: 'held' };
    t.c.plan.push(held);
    t.page.commit(amendCableRow); // the old session's update is in flight
    await t.clock.advance(700);
    assert.equal(t.c.log.at(-1).mode, 'held');
    t.page.discard();
    assert.equal(t.storage.getItem(store.groupSessionKey(SCOPE)), null, 'discard removes the stored entry');
    const next = newSession(`00000000-0000-4000-8000-0000000000e${outcome === 'ok' ? 7 : 9}`);
    t.page.start(next);
    await t.clock.advance(5000);
    const before = t.storage.getItem(store.groupSessionKey(SCOPE));
    const memoryBefore = clone(t.page.sessionRef.current);
    const mirrorBefore = { sessionId: t.page.mirror.current.sessionId, revision: t.page.mirror.current.revision };
    held[outcome](); // the old session's answer arrives late
    await t.clock.advance(5 * 60 * 1000);
    assert.equal(t.storage.getItem(store.groupSessionKey(SCOPE)), before, `${outcome}: storage unchanged by the late answer`);
    assert.deepEqual(t.page.sessionRef.current, memoryBefore, `${outcome}: memory unchanged`);
    assert.deepEqual({ sessionId: t.page.mirror.current.sessionId, revision: t.page.mirror.current.revision }, mirrorBefore);
    const raw = JSON.parse(before);
    assert.deepEqual([raw.id, raw._mirror.sessionId, raw._mirror.revision], [next.id, next.id, 0]);
    assert.ok(!t.c.log.some((l) => l.method === 'PATCH' && l.path.endsWith(next.id)), 'no old revision sent to the new session');
    assert.equal(t.c.log.filter((l) => l.path.endsWith(t.id)).length, 1, 'the old session is not retried');
  }
});

test('legacy ambiguity survives repeated reloads, including a create stored before it was answered; nothing is sent without the choice', async () => {
  const storage = memoryStorage();
  const server = createGroupServer();
  const clock = fakeClock();
  const c = controlledApi(server);
  const A = newSession('00000000-0000-4000-8000-0000000000f5');
  server.request('POST', '/group-sessions', { id: A.id, title: A.title, mode: 'stations', participant_ids: [TRAINEES[0].id, TRAINEES[1].id], station_state: A });
  legacyEntry(storage, amendCableRow(A));
  // First mount: the create is stored write-ahead, then gets no answer.
  c.plan.push({ mode: 'network' });
  let page = mountPage({ storage, api: c.api, clock });
  page.mountEffect();
  await clock.advance(1000);
  const stored = JSON.parse(storage.getItem(store.groupSessionKey(SCOPE)))._mirror;
  assert.equal(stored.provenance, 'legacy', 'the stored create is marked as unproven legacy recovery');
  for (let i = 0; i < 3; i += 1) {
    page.unmount();
    page = mountPage({ storage, api: c.api, clock });
    page.mountEffect();
    await clock.advance(5 * 60 * 1000);
    assert.equal(page.states.at(-1), 'diverged', `reload ${i + 1}: still asks`);
    assert.equal(page.sessionRef.current.amendments.length, 1, `reload ${i + 1}: this device's copy kept`);
    assert.equal(account(server, A.id).station_state.amendments.length, 0, `reload ${i + 1}: the account copy not overwritten`);
    const meta = JSON.parse(storage.getItem(store.groupSessionKey(SCOPE)))._mirror;
    assert.deepEqual([meta.provenance, meta.revision], ['legacy', null], `reload ${i + 1}: no trusted revision stored while undecided`);
  }
  assert.equal(c.log.filter((l) => l.method === 'PATCH').length, 0, 'never an automatic update');
});

test('legacy choice "send this device\'s plan" after the account changed again is still a conditional update: the newer copy is adopted, not overwritten', async () => {
  const storage = memoryStorage();
  const server = createGroupServer();
  const clock = fakeClock();
  const c = controlledApi(server);
  const A = newSession('00000000-0000-4000-8000-0000000000f6');
  server.request('POST', '/group-sessions', { id: A.id, title: A.title, mode: 'stations', participant_ids: [TRAINEES[0].id, TRAINEES[1].id], station_state: A });
  legacyEntry(storage, amendCableRow(A));
  const page = mountPage({ storage, api: c.api, clock });
  page.mountEffect();
  await clock.advance(60 * 1000);
  assert.equal(page.states.at(-1), 'diverged');
  // Before the coach chooses, another device changes the account copy again.
  const g = account(server, A.id);
  Object.assign(g, { station_state: { ...g.station_state, title: 'Plan C2 (other device)' }, revision: g.revision + 1 });
  await helper.resolveDivergence(page.ctx, 'local');
  await clock.advance(60 * 1000);
  assert.equal(account(server, A.id).station_state.title, 'Plan C2 (other device)', 'not overwritten');
  assert.equal(page.sessionRef.current.title, 'Plan C2 (other device)', 'the newer copy is adopted under the existing policy');
  assert.equal(page.states.at(-1), 'replaced');
  const patches = c.log.filter((l) => l.method === 'PATCH');
  assert.equal(patches[0].body.base_revision, 0, 'conditional on the revision the coach saw');
});

test('storage refused when the answer arrives: the refusal is reported, and the next reload confirms without a duplicate commit', async () => {
  const t = await startedAndSynced('00000000-0000-4000-8000-0000000000ea');
  const held = { mode: 'held' };
  t.c.plan.push(held);
  t.page.commit(amendCableRow);
  await t.clock.advance(700);
  t.storage.deny = true; // the write that records the answer will be refused
  held.ok();
  await t.clock.advance(1000);
  assert.equal(t.page.storageResults.at(-1), false, 'the refused write is reported (the page shows "not stored")');
  assert.equal(account(t.server, t.id).revision, 1);
  t.storage.deny = false;
  const page = await reload(t);
  assert.equal(page.sessionRef.current.amendments.length, 1);
  assert.equal(account(t.server, t.id).revision, 1, 'the stored request is confirmed, not committed twice');
  assert.equal(page.states.at(-1), 'saved');
});

test('two instances: a late answer for an unmounted instance never overwrites the newer instance\'s stored amendment', async () => {
  const t = await startedAndSynced('00000000-0000-4000-8000-0000000000eb');
  const held = { mode: 'held' };
  t.c.plan.push(held);
  t.page.commit(amendCableRow); // X: its update is in flight when the coach navigates away
  await t.clock.advance(700);
  t.page.unmount();
  for (let i = 0; i < 20; i += 1) t.c.plan.push({ mode: 'network' }); // the new instance gets no answers
  const page2 = mountPage({ storage: t.storage, api: t.c.api, clock: t.clock });
  page2.mountEffect();
  await t.clock.advance(1000);
  page2.commit((s) => model.amendStation(s, { id: '00000000-0000-4000-8000-0000000000b1', stationId: s.stations[0].id, exercise: { exercise_library_id: 'fict-lib-pushup', name: 'Push-up', sets: '2', reps: '12' }, reason: 'Bench taken' }));
  await t.clock.advance(1000);
  assert.equal(store.loadGroupSession(t.storage, SCOPE).amendments.length, 2, 'the new instance stored X and its newer amendment');
  held.ok(); // the unmounted instance's answer arrives late
  await t.clock.advance(1000);
  assert.equal(store.loadGroupSession(t.storage, SCOPE).amendments.length, 2, 'the late answer did not overwrite the newer stored copy');
  t.c.plan.length = 0;
  page2.unmount();
  const page3 = mountPage({ storage: t.storage, api: t.c.api, clock: t.clock });
  page3.mountEffect();
  await t.clock.advance(5 * 60 * 1000);
  assert.equal(page3.sessionRef.current.amendments.length, 2, 'after a reload both amendments are here');
  assert.equal(account(t.server, t.id).station_state.amendments.length, 2, 'and on the account');
});

const INCONSISTENT = {
    'legacy provenance with a revision': (A, B) => ({ v: 1, sessionId: A.id, provenance: 'legacy', revision: 0, unresolved: null }),
    'update carrying another session': (A, B) => ({ v: 1, sessionId: A.id, provenance: 'known', revision: 0, unresolved: { kind: 'update', sessionId: A.id, snapshot: B, body: { base_revision: 0, station_state: { ...B, id: '00000000-0000-4000-8000-00000000dead' }, participant_ids: [] } } }),
    'body and snapshot disagree': (A, B) => ({ v: 1, sessionId: A.id, provenance: 'known', revision: 0, unresolved: { kind: 'update', sessionId: A.id, snapshot: B, body: { base_revision: 0, station_state: { ...B, title: 'Forged' }, participant_ids: [] } } }),
    'update base differs from the confirmed revision': (A, B) => ({ v: 1, sessionId: A.id, provenance: 'known', revision: 3, unresolved: { kind: 'update', sessionId: A.id, snapshot: B, body: { base_revision: 0, station_state: B, participant_ids: [] } } }),
    'create after a confirmed revision': (A, B) => ({ v: 1, sessionId: A.id, provenance: 'known', revision: 0, unresolved: { kind: 'create', sessionId: A.id, snapshot: B, body: { id: A.id, title: B.title, mode: 'stations', participant_ids: [], station_state: B } } }),
};
for (const [name, make] of Object.entries(INCONSISTENT)) {
  test(`inconsistent stored bookkeeping (${name}) is refused as a whole: nothing sent, both copies kept`, async () => {
    const storage = memoryStorage();
    const server = createGroupServer();
    const clock = fakeClock();
    const c = controlledApi(server);
    const A = newSession('00000000-0000-4000-8000-0000000000f7');
    const C = { ...A, title: 'Plan C (other device)' };
    server.request('POST', '/group-sessions', { id: A.id, title: C.title, mode: 'stations', participant_ids: [TRAINEES[0].id], station_state: C });
    const B = amendCableRow(A);
    legacyEntry(storage, B, { _mirror: make(A, B) });
    const page = mountPage({ storage, api: c.api, clock });
    page.mountEffect();
    await clock.advance(5 * 60 * 1000);
    assert.equal(account(server, A.id).station_state.title, 'Plan C (other device)', `${name}: the account copy is not overwritten`);
    assert.equal(account(server, A.id).station_state.id, A.id, `${name}`);
    assert.equal(page.sessionRef.current.amendments.length, 1, `${name}: this device's copy kept`);
    assert.equal(page.states.at(-1), 'diverged', `${name}: shown as undecided`);
    assert.equal(c.log.filter((l) => l.method === 'PATCH').length, 0, `${name}: nothing sent without a choice`);
  });
}
