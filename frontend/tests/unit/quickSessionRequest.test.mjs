import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PENDING_PREFIX, QUICK_SESSION_COPY, buildQuickSessionBody, captureQuickOperation, createQuickSessionController,
  discardPendingKey, isCurrentQuickOperation, listPending, parsePendingValue, pendingKey, pendingRecord,
  persistPending, removeMatchingPending,
} from '../../src/lib/quickSessionRequest.js';

const COACH = 'coach_1';
const CLIENT = 'client_sarah';
const OTHER_CLIENT = 'client_marcus';
const ENV = 'preview';

function fakeStorage({ blocked = false, full = false } = {}) {
  const map = new Map();
  const writes = [];
  return {
    map, writes,
    get length() { if (blocked) throw new Error('blocked'); return map.size; },
    key(i) { if (blocked) throw new Error('blocked'); return [...map.keys()][i] ?? null; },
    getItem(key) { if (blocked) throw new Error('blocked'); return map.has(key) ? map.get(key) : null; },
    setItem(key, value) {
      if (blocked) throw new Error('blocked');
      if (full) throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' });
      writes.push([key, value]); map.set(key, String(value));
    },
    removeItem(key) { if (blocked) throw new Error('blocked'); map.delete(key); },
  };
}

function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Every call returns a pending promise the test settles explicitly.
function fakeApi() {
  const calls = [];
  const enqueue = (method) => (url, body) => { const d = deferred(); calls.push({ method, url, body, ...d }); return d.promise; };
  return { calls, get: enqueue('get'), post: enqueue('post') };
}
const httpError = (status, data = {}) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });
const networkError = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settle(call, outcome) {
  if (outcome instanceof Error) call.reject(outcome); else call.resolve({ data: outcome });
  await flush(); await flush();
}

let uuidCounter = 0;
const uuid = () => { uuidCounter += 1; return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, '0')}`; };

function harness({ storage = fakeStorage(), now = '2026-10-09T18:00:00Z' } = {}) {
  const api = fakeApi();
  const ctx = { actorId: COACH, authEpoch: 1, clientId: CLIENT, environment: ENV };
  const clock = { now: new Date(now) };
  const started = [];
  const states = [];
  const controller = createQuickSessionController({
    api, storage, uuid, getContext: () => ({ ...ctx }), clock: () => clock.now,
    onChange: (state) => states.push(state), onStarted: (log) => started.push(log),
  });
  return { api, ctx, clock, storage, controller, started, states };
}

const form = (overrides = {}) => ({
  assigned_for: '', name: '', notes: 'Easy pace',
  exercises: [{ custom_name: 'Plank', sets: '2', tracking_type: 'duration', duration_value: '45', duration_unit: 's', default_load_value: '', default_load_unit: 'lb' }],
  ...overrides,
});
const assignment = (id = 'qa-1', extra = {}) => ({ id, kind: 'quick', client_id: CLIENT, library_template_id: null, workout: { name: 'Quick session · 2026-10-09' }, ...extra });
const createCalls = (api) => api.calls.filter((c) => c.method === 'post' && c.url === '/programs/quick-sessions');
const keysIn = (storage) => [...storage.map.keys()];

test('pending keys, records and namespace enumeration are exact and scoped', () => {
  const requestId = uuid();
  assert.equal(pendingKey({ environment: ENV, actorId: COACH, requestId }), `${PENDING_PREFIX}${ENV}:${COACH}:${requestId}`);
  const storage = fakeStorage();
  const mine = pendingRecord({ requestId, clientId: CLIENT, createdAt: '2026-10-09T18:00:00.000Z' });
  assert.deepEqual(Object.keys(mine).sort(), ['client_id', 'created_at', 'request_id', 'state', 'v']);
  persistPending(storage, mine, { environment: ENV, actorId: COACH });
  const otherClient = pendingRecord({ requestId: uuid(), clientId: OTHER_CLIENT, createdAt: '2026-10-09T18:00:01.000Z' });
  persistPending(storage, otherClient, { environment: ENV, actorId: COACH });
  persistPending(storage, pendingRecord({ requestId: uuid(), clientId: CLIENT, createdAt: '2026-10-09T18:00:02.000Z' }), { environment: ENV, actorId: 'coach_2' });
  persistPending(storage, pendingRecord({ requestId: uuid(), clientId: CLIENT, createdAt: '2026-10-09T18:00:03.000Z' }), { environment: 'production', actorId: COACH });
  storage.map.set('unrelated', 'x');
  const listed = listPending(storage, { environment: ENV, actorId: COACH, clientId: CLIENT });
  assert.deepEqual(listed.records, [mine]);
  assert.deepEqual(listed.corrupt, []);
  assert.equal(persistPending(storage, mine, { environment: 'bad env!', actorId: COACH }).recoverable, false);
});

test('A5 corrupt entries are reported, never trusted for routing, and only a scoped discard removes them', () => {
  const storage = fakeStorage();
  const scope = { environment: ENV, actorId: COACH };
  const good = pendingRecord({ requestId: uuid(), clientId: CLIENT, createdAt: '2026-10-09T18:00:00.000Z' });
  const ns = `${PENDING_PREFIX}${ENV}:${COACH}:`;
  storage.map.set(`${ns}${uuid()}`, '{not json');
  storage.map.set(`${ns}${uuid()}`, JSON.stringify({ ...good, request_id: uuid(), exercises: ['Plank'] }));
  storage.map.set(`${ns}not-a-uuid`, JSON.stringify(good));
  storage.map.set(`${ns}${uuid()}`, JSON.stringify(good));   // value names a different request id than its key
  const listed = listPending(storage, { ...scope, clientId: CLIENT });
  assert.equal(listed.records.length, 0);
  assert.equal(listed.corrupt.length, 4);
  for (const key of listed.corrupt) {
    assert.equal(removeMatchingPending(storage, scope, good), true, 'the good record itself is absent, so nothing to remove');
    assert.ok(storage.map.has(key), 'corrupt entries are retained without an explicit discard');
  }
  assert.equal(discardPendingKey(storage, scope, 'unrelated-key'), false);
  assert.equal(discardPendingKey(storage, { environment: ENV, actorId: 'coach_2' }, listed.corrupt[0]), false, 'other namespaces cannot discard');
  assert.equal(discardPendingKey(storage, scope, listed.corrupt[0]), true);
  assert.equal(storage.map.has(listed.corrupt[0]), false);
  assert.equal(parsePendingValue(JSON.stringify({ ...good, v: 2 })), null);
  assert.equal(parsePendingValue(JSON.stringify({ ...good, client_id: 'x y' })), null);
});

test('fence tuple compares actor, auth epoch, page, request, client, generation and assignment', () => {
  const base = { actorId: COACH, authEpoch: 3, pageToken: 'p', requestId: 'r', clientId: CLIENT, operationGeneration: 2, assignmentId: 'a' };
  const fence = captureQuickOperation(base);
  assert.equal(isCurrentQuickOperation(fence, base), true);
  for (const [key, value] of Object.entries({ actorId: 'coach_2', authEpoch: 4, pageToken: 'q', requestId: 's', clientId: OTHER_CLIENT, operationGeneration: 3, assignmentId: 'b' })) {
    assert.equal(isCurrentQuickOperation(fence, { ...base, [key]: value }), false, key);
  }
});

test('A4 the routing record is persisted and read back BEFORE dispatch and never holds the workout', async () => {
  const { api, controller, storage } = harness();
  const pending = controller.save(form({ name: 'Secret Title', notes: 'Private note' }), {});
  await flush();
  const [create] = createCalls(api);
  assert.ok(create, 'create dispatched');
  const [key] = keysIn(storage);
  assert.equal(key, pendingKey({ environment: ENV, actorId: COACH, requestId: create.body.request_id }));
  const stored = JSON.parse(storage.map.get(key));
  assert.deepEqual(Object.keys(stored).sort(), ['client_id', 'created_at', 'request_id', 'state', 'v']);
  assert.equal(controller.getState().recoverable, true);
  for (const [, value] of storage.writes) {
    for (const leak of ['Secret Title', 'Private note', 'Plank', 'exercises', 'token', 'hash', 'v1:']) assert.ok(!value.includes(leak), leak);
  }
  assert.deepEqual(Object.keys(create.body).sort(), ['assigned_for', 'client_id', 'exercises', 'name', 'notes', 'request_id']);
  assert.equal(create.body.client_id, CLIENT);
  await settle(create, { state: 'created', assignment: assignment() });
  await pending;
});

test('A4 timeout, 5xx and network loss keep the same UUID and resend the identical frozen body; storage is never rewritten', async () => {
  const { api, controller, storage, clock } = harness({ now: '2026-10-10T05:59:00Z' });   // 23:59 in Denver
  controller.save(form());
  await flush();
  const [first] = createCalls(api);
  assert.equal(first.body.assigned_for, '2026-10-09');
  assert.equal(first.body.name, 'Quick session · 2026-10-09');
  await settle(first, httpError(504));
  assert.equal(controller.getState().phase, 'uncertain');
  clock.now = new Date('2026-10-10T06:01:00Z');    // past Denver midnight
  controller.save(form({ name: 'Edited meanwhile' }));
  await flush();
  const second = createCalls(api)[1];
  assert.deepEqual(second.body, first.body, 'identical retry: frozen date/title, no edits');
  await settle(second, networkError());
  controller.save(form());
  await flush();
  const third = createCalls(api)[2];
  assert.deepEqual(third.body, first.body);
  assert.equal(storage.writes.length, 1, 'the immutable record was written once');
  await settle(third, { state: 'replayed', assignment: assignment() });
  assert.equal(controller.getState().phase, 'saved');
  assert.equal(keysIn(storage).length, 0, 'known success clears the exact key');
});

test('A4 masked not_found keeps the UUID; re-entry needs a fresh target-access check and reuses the same UUID', async () => {
  const { api, controller, storage } = harness();
  controller.save(form());
  await flush();
  const [first] = createCalls(api);
  await settle(first, httpError(404, { state: 'not_found' }));
  assert.equal(controller.getState().phase, 'unrecovered');
  assert.equal(controller.getState().message, QUICK_SESSION_COPY.unrecovered);
  assert.equal(keysIn(storage).length, 1, 'absence never proves rollback');
  assert.equal(await controller.save(form()), 'needs_reentry', 'no blind resend after masked absence');
  const record = parsePendingValue(storage.map.get(keysIn(storage)[0]));
  // Denied access check: uncertainty kept, nothing shown.
  const denied = controller.reenter(record);
  await flush();
  await settle(api.calls.at(-1), httpError(404));
  assert.equal(await denied, 'denied');
  assert.equal(controller.getState().assignment, null);
  assert.equal(keysIn(storage).length, 1);
  // Allowed access check: re-enter under the same UUID.
  const allowed = controller.reenter(record);
  await flush();
  const check = api.calls.at(-1);
  assert.equal(check.url, `/clients/${CLIENT}`);
  await settle(check, { id: CLIENT });
  assert.equal(await allowed, 'reentry');
  controller.save(form({ name: 'Re-entered' }));
  await flush();
  const reentered = createCalls(api).at(-1);
  assert.equal(reentered.body.request_id, first.body.request_id);
  assert.equal(reentered.body.name, 'Re-entered');
  assert.equal(storage.writes.length, 1);
});

test('A3/A4 mismatch resolves through the guarded status read to whichever body actually committed', async () => {
  const { api, controller, storage } = harness();
  controller.save(form());
  await flush();
  await settle(createCalls(api)[0], httpError(409, { state: 'request_mismatch' }));
  const status = api.calls.at(-1);
  assert.match(status.url, /^\/programs\/quick-sessions\/requests\/[0-9a-f-]{36}$/);
  await settle(status, { state: 'committed', assignment: assignment('winner', { workout: { name: 'Original body' } }) });
  const state = controller.getState();
  assert.equal(state.phase, 'saved');
  assert.equal(state.assignment.id, 'winner');
  assert.equal(keysIn(storage).length, 0);
  // Identity rotated only after known success: the next quick session is a new request.
  controller.resetForNew();
  controller.save(form());
  await flush();
  assert.notEqual(createCalls(api).at(-1).body.request_id, createCalls(api)[0].body.request_id);
});

test('A4 mismatch followed by lost access or a status read error hides details and retains the pending record', async () => {
  for (const failure of [httpError(404, { state: 'not_found' }), httpError(500), networkError()]) {
    const { api, controller, storage } = harness();
    controller.save(form());
    await flush();
    await settle(createCalls(api)[0], httpError(409, { state: 'request_mismatch' }));
    await settle(api.calls.at(-1), failure);
    const state = controller.getState();
    assert.equal(state.assignment, null);
    assert.equal(state.phase, failure.response?.status === 404 ? 'unrecovered' : 'uncertain');
    assert.equal(keysIn(storage).length, 1);
  }
});

test('A5 stale replies after account, same-actor re-login, page or client change perform no side effects', async () => {
  for (const change of ['actor', 'epoch', 'client', 'dispose']) {
    const { api, controller, storage, ctx, started } = harness();
    controller.save(form(), { start: true, library: true });
    await flush();
    const [create] = createCalls(api);
    if (change === 'actor') ctx.actorId = 'coach_2';
    if (change === 'epoch') ctx.authEpoch += 1;          // fresh login by the same coach
    if (change === 'client') ctx.clientId = OTHER_CLIENT;
    if (change === 'dispose') controller.dispose();
    await settle(create, { state: 'created', assignment: assignment() });
    assert.equal(keysIn(storage).length, 1, `${change}: stale success must not clear storage`);
    assert.equal(api.calls.length, 1, `${change}: no chained start/library`);
    assert.equal(started.length, 0);
    if (change !== 'dispose') assert.notEqual(controller.getState().phase, 'saved', change);
  }
});

test('A5 a second request survives an old success, and a removed entry is never resurrected', async () => {
  const storage = fakeStorage();
  const a = harness({ storage });
  const b = harness({ storage });
  a.controller.save(form({ name: 'Tab A' }));
  b.controller.save(form({ name: 'Tab B' }));
  await flush();
  const aCreate = createCalls(a.api)[0];
  const bCreate = createCalls(b.api)[0];
  assert.notEqual(aCreate.body.request_id, bCreate.body.request_id);
  assert.equal(keysIn(storage).length, 2);
  await settle(aCreate, { state: 'created', assignment: assignment('qa-a') });
  assert.deepEqual(keysIn(storage), [pendingKey({ environment: ENV, actorId: COACH, requestId: bCreate.body.request_id })]);
  // Another tab removed B's entry; B's retry and late success never rewrite it.
  storage.map.clear();
  await settle(bCreate, httpError(503));
  b.controller.save(form());
  await flush();
  assert.equal(keysIn(storage).length, 0, 'retry does not recreate a removed record');
  await settle(createCalls(b.api)[1], { state: 'created', assignment: assignment('qa-b') });
  assert.equal(keysIn(storage).length, 0);
  assert.equal(b.controller.getState().assignment.id, 'qa-b');
});

test('A5 shared-UUID tabs converge through server status without rewriting or resubmitting', async () => {
  const storage = fakeStorage();
  const a = harness({ storage });
  a.controller.save(form());
  await flush();
  const requestId = createCalls(a.api)[0].body.request_id;
  const b = harness({ storage });
  const recovering = b.controller.recoverAll();
  await flush();
  const [status] = b.api.calls;
  assert.equal(status.url, `/programs/quick-sessions/requests/${requestId}`);
  assert.equal(createCalls(b.api).length, 0, 'a storage-driven refresh never resubmits');
  await settle(status, { state: 'committed', assignment: assignment('qa-shared') });
  await recovering;
  assert.deepEqual(b.controller.getState().recovered.map((entry) => entry.assignment.id), ['qa-shared']);
  assert.equal(b.controller.getState().phase, 'editing', 'recovery never replaces the builder in use');
  assert.equal(keysIn(storage).length, 0);
  await settle(createCalls(a.api)[0], { state: 'replayed', assignment: assignment('qa-shared') });
  assert.equal(keysIn(storage).length, 0);
  assert.equal(storage.writes.length, 1);
});

test('A4 reload recovery: not_found stays uncertain and offers no automatic Start/library', async () => {
  const storage = fakeStorage();
  const record = pendingRecord({ requestId: uuid(), clientId: CLIENT, createdAt: '2026-10-09T18:00:00.000Z' });
  persistPending(storage, record, { environment: ENV, actorId: COACH });
  const { api, controller } = harness({ storage });
  controller.recoverAll();
  await flush();
  await settle(api.calls[0], httpError(404, { state: 'not_found' }));
  assert.equal(controller.getState().recoveries[record.request_id].state, 'unrecovered');
  assert.equal(api.calls.length, 1);
  assert.equal(keysIn(storage).length, 1);
  // Explicit, scoped discard removes exactly that entry and invalidates its reads.
  assert.equal(controller.discard(record), true);
  assert.equal(keysIn(storage).length, 0);
  assert.equal(controller.getState().recoveries[record.request_id], undefined);
});

test('A5 blocked or full storage still saves, with recovery reported unavailable', async () => {
  for (const options of [{ blocked: true }, { full: true }]) {
    const { api, controller } = harness({ storage: fakeStorage(options) });
    controller.save(form());
    await flush();
    assert.equal(controller.getState().recoverable, false);
    assert.equal(createCalls(api).length, 1);
    await settle(createCalls(api)[0], { state: 'created', assignment: assignment() });
    assert.equal(controller.getState().phase, 'saved');
  }
  assert.equal(listPending(fakeStorage({ blocked: true }), { environment: ENV, actorId: COACH, clientId: CLIENT }).available, false);
});

test('A6 follow-ups are independent: library failure never blocks Start, and retries never call create', async () => {
  const { api, controller, started } = harness();
  controller.save(form(), { start: true, library: true });
  await flush();
  await settle(createCalls(api)[0], { state: 'created', assignment: assignment('qa-1') });
  const library = api.calls.at(-1);
  assert.equal(library.url, '/programs/quick-sessions/qa-1/save-to-library');
  await settle(library, networkError());
  assert.equal(controller.getState().library.state, 'failed');
  const startCall = api.calls.at(-1);
  assert.deepEqual([startCall.url, startCall.body], ['/workout-logs/start', { client_id: CLIENT, workout_assignment_id: 'qa-1' }]);
  await settle(startCall, httpError(409, { error: 'Finish or abandon your active workout first', active_workout: { id: 'log-other' } }));
  assert.equal(controller.getState().start.state, 'conflict');
  assert.equal(controller.getState().phase, 'saved', 'a failed follow-up leaves the confirmed assignment');
  // Lost start reply: retry only start.
  controller.retryStart('qa-1');
  await flush();
  await settle(api.calls.at(-1), networkError());
  controller.retryStart('qa-1');
  await flush();
  await settle(api.calls.at(-1), { outcome: 'resumed', workout_log: { id: 'log-1' } });
  assert.deepEqual(started, [{ id: 'log-1' }]);
  // Lost library reply: retry only library; the server returns the one committed pointer.
  controller.retryLibrary('qa-1');
  await flush();
  await settle(api.calls.at(-1), { state: 'replayed', template_id: 'tmpl-1' });
  assert.equal(controller.getState().library.state, 'saved');
  assert.equal(createCalls(api).length, 1, 'start and library retries never resend create');
});

test('A5 stale Start/library replies after an account change are ignored', async () => {
  const { api, controller, ctx, started } = harness();
  const saved = controller.save(form());
  await settle(createCalls(api)[0], { state: 'created', assignment: assignment('qa-1') });
  await saved;
  api.calls.length = 0;
  controller.retryStart('qa-1');
  controller.retryLibrary('qa-1');
  await flush();
  const [startCall, libraryCall] = api.calls;
  ctx.authEpoch += 1;
  await settle(startCall, { outcome: 'started', workout_log: { id: 'log-1' } });
  await settle(libraryCall, { state: 'saved', template_id: 'tmpl-1' });
  assert.deepEqual(started, []);
  assert.notEqual(controller.getState().library.state, 'saved');
  // A superseded start reply is also stale.
  const { api: api2, controller: c2, started: started2 } = harness();
  const saved2 = c2.save(form());
  await settle(createCalls(api2)[0], { state: 'created', assignment: assignment('qa-1') });
  await saved2;
  api2.calls.length = 0;
  c2.retryStart('qa-1'); await flush();
  c2.retryStart('qa-1'); await flush();
  await settle(api2.calls[0], { outcome: 'started', workout_log: { id: 'old' } });
  assert.deepEqual(started2, []);
  await settle(api2.calls[1], { outcome: 'resumed', workout_log: { id: 'new' } });
  assert.deepEqual(started2, [{ id: 'new' }]);
});

test('definitive 4xx rejections keep the UUID and let the coach correct and resend', async () => {
  const { api, controller, storage } = harness();
  controller.save(form());
  await flush();
  await settle(createCalls(api)[0], httpError(400, { error: 'Add at least one exercise' }));
  assert.equal(controller.getState().phase, 'rejected');
  assert.equal(controller.getState().message, 'Add at least one exercise');
  controller.save(form({ name: 'Fixed' }));
  await flush();
  assert.equal(createCalls(api)[1].body.request_id, createCalls(api)[0].body.request_id);
  assert.equal(createCalls(api)[1].body.name, 'Fixed');
  assert.equal(storage.writes.length, 1);
});

test('the request body carries only allowlisted accepted fields', () => {
  const body = buildQuickSessionBody({
    assigned_for: '', name: '  ', notes: '  ',
    exercises: [{ _uid: 'x', id: 'row', library_exercise: {}, custom_name: 'Row', default_load_value: '', default_load_unit: 'lb', rest: '60s', rest_seconds: 60 }],
  }, { requestId: 'r', clientId: CLIENT, today: '2026-10-09' });
  assert.deepEqual(body, { request_id: 'r', client_id: CLIENT, assigned_for: '2026-10-09', name: 'Quick session · 2026-10-09', notes: null, exercises: [{ custom_name: 'Row', rest: '60s' }] });
});

// Independent review reproducer: deferred A responses must not own B's visible state.
for (const operation of ['start', 'library']) {
  for (const failure of [false, true]) {
    for (const transition of ['reset', 'new-request', 'reenter']) {
      test(`F1 ${operation} ${failure ? 'failure' : 'success'} is stale after ${transition}`, async () => {
        const { api, controller, started } = harness();
        const first = controller.save(form());
        await settle(createCalls(api)[0], { state: 'created', assignment: assignment('a') });
        await first;
        const old = operation === 'start' ? controller.start('a') : controller.saveToLibrary('a');
        const call = api.calls.at(-1);
        if (transition === 'reset') controller.resetForNew();
        if (transition === 'reenter') {
          const record = pendingRecord({ requestId: uuid(), clientId: CLIENT, createdAt: '2026-10-09T18:00:00.000Z' });
          const reentry = controller.reenter(record);
          await settle(api.calls.at(-1), { id: CLIENT });
          await reentry;
        }
        const next = controller.save(form({ name: 'B' }));
        await settle(createCalls(api).at(-1), { state: 'created', assignment: assignment('b') });
        await next;
        const before = controller.getState();
        await settle(call, failure ? httpError(409, { error: 'Old failure', active_workout: { id: 'old-log' } })
          : operation === 'start' ? { workout_log: { id: 'old-log' } } : { template_id: 'old-template' });
        assert.equal(await old, 'stale');
        assert.deepEqual(controller.getState(), before);
        assert.deepEqual(started, []);
      });
    }
  }
}

for (const failure of [false, true]) {
  test(`F1 create library-then-Start continuation stops after Done (${failure ? 'failure' : 'success'})`, async () => {
    const { api, controller, started } = harness();
    const old = controller.save(form(), { library: true, start: true });
    await settle(createCalls(api)[0], { state: 'created', assignment: assignment('a') });
    const library = api.calls.at(-1);
    controller.resetForNew();
    const next = controller.save(form());
    await settle(createCalls(api)[1], { state: 'created', assignment: assignment('b') });
    await next;
    const before = controller.getState();
    await settle(library, failure ? networkError() : { template_id: 'old-template' });
    assert.equal(api.calls.filter((call) => call.url === '/workout-logs/start').length, 0);
    await old;
    assert.deepEqual(controller.getState(), before);
    assert.deepEqual(started, []);
  });
}

test('F1 a pending re-entry cannot replace a newer request', async () => {
  const { api, controller } = harness();
  const reentry = controller.reenter(pendingRecord({ requestId: uuid(), clientId: CLIENT, createdAt: '2026-10-09T18:00:00.000Z' }));
  const access = api.calls[0];
  const next = controller.save(form());
  await settle(createCalls(api)[0], { state: 'created', assignment: assignment('b') });
  await next;
  const before = controller.getState();
  await settle(access, { id: CLIENT });
  assert.equal(await reentry, 'stale');
  assert.deepEqual(controller.getState(), before);
});

test('F1 follow-ups reject an assignment that does not own the visible session before dispatch', async () => {
  const { api, controller } = harness();
  const saved = controller.save(form());
  await settle(createCalls(api)[0], { state: 'created', assignment: assignment('b') });
  await saved;
  const before = controller.getState();
  const wrongStart = controller.start('a');
  const wrongLibrary = controller.saveToLibrary('a');
  assert.equal(api.calls.length, 1);
  assert.equal(await wrongStart, 'stale');
  assert.equal(await wrongLibrary, 'stale');
  assert.deepEqual(controller.getState(), before);
});

for (const operation of ['start', 'library']) {
  for (const failure of [false, true]) {
    test(`F1 ${operation} is invalidated while newer re-entry access is pending (${failure ? 'failure' : 'success'})`, async () => {
      const { api, controller, started } = harness();
      const saved = controller.save(form());
      await settle(createCalls(api)[0], { state: 'created', assignment: assignment('a') });
      await saved;
      const old = operation === 'start' ? controller.start('a') : controller.saveToLibrary('a');
      const response = api.calls.at(-1);
      const reentry = controller.reenter(pendingRecord({ requestId: uuid(), clientId: CLIENT, createdAt: '2026-10-09T18:00:00.000Z' }));
      const access = api.calls.at(-1);
      const before = controller.getState();
      await settle(response, failure ? networkError() : operation === 'start' ? { workout_log: { id: 'old-log' } } : { template_id: 'old-template' });
      assert.equal(await old, 'stale');
      assert.deepEqual(controller.getState(), before);
      assert.deepEqual(started, []);
      await settle(access, { id: CLIENT });
      await reentry;
    });
  }
}
