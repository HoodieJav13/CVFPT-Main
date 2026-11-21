import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPABILITY_PATH, classifyFailure, createPendingStore, freezeRequest, mergeActivity, newRequestId, probeCapability, replayNotice, submitFrozen,
} from '../../src/lib/contextEntry.js';

function fakeStorage() {
  const map = new Map();
  return {
    map,
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] ?? null; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
  };
}
const httpError = (status, data = {}) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });
const networkError = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });

// A scripted API: capability answers from `capability`, each request from the next `outcomes` entry.
function fakeApi({ capability = { data: { feature: 'whole_week', contract: 1, outside_activity_writes: 'guarded' } }, outcomes = [] } = {}) {
  const sent = [];
  const probes = [];
  return {
    sent,
    probes,
    async get(url) {
      probes.push(url);
      if (capability instanceof Error) throw capability;
      return capability;
    },
    async request(config) {
      sent.push(JSON.parse(JSON.stringify(config)));
      const next = outcomes.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  };
}
const frozenCreate = () => freezeRequest({
  kind: 'create', method: 'post', url: '/outside-activities/mine',
  body: { request_id: newRequestId(), revision: 0, activity_type: 'run', occurred_on: '2026-03-08', label: null, duration_seconds: null, effort_rpe: null, note: null },
  summary: 'Run on Sun, Mar 8',
});

test('frozen requests cannot be edited after freezing', () => {
  const frozen = frozenCreate();
  assert.throws(() => { frozen.body.duration_seconds = 60; }, TypeError);
  assert.throws(() => { frozen.body.request_id = 'other'; }, TypeError);
  assert.equal(frozen.body.duration_seconds, null);
});

test('capability is probed before sending; an older backend never receives the guarded body', async () => {
  const storage = fakeStorage();
  const store = createPendingStore({ getStorage: () => storage, scope: 'live:u1:c1' });
  const api = fakeApi({ capability: httpError(404, { error: 'Not found' }) });
  const result = await submitFrozen({ api, frozen: frozenCreate(), store });
  assert.equal(result.state, 'unsupported');
  assert.deepEqual(api.probes, [CAPABILITY_PATH]);
  assert.equal(api.sent.length, 0);
  assert.equal(store.load(), null, 'nothing was sent, so nothing is pending');
  assert.equal(await probeCapability(fakeApi({ capability: { data: { feature: 'whole_week', contract: 2 } } })), false);
  assert.equal(await probeCapability(fakeApi({ capability: networkError() })), 'offline');
});

test('a fresh save while offline is not sent and leaves no pending record', async () => {
  const storage = fakeStorage();
  const store = createPendingStore({ getStorage: () => storage, scope: 'live:u1:c1' });
  const api = fakeApi({ capability: networkError() });
  const result = await submitFrozen({ api, frozen: frozenCreate(), store });
  assert.equal(result.state, 'not_sent');
  assert.equal(api.sent.length, 0);
  assert.equal(store.load(), null);
});

test('lost response keeps the SAME operation in memory; reload keeps only an interruption marker', async () => {
  const storage = fakeStorage();
  const frozen = frozenCreate();
  const first = fakeApi({ outcomes: [networkError()] });
  const original = createPendingStore({ getStorage: () => storage, scope: 'live:u1:c1' });
  const lost = await submitFrozen({ api: first, frozen, store: original });
  assert.equal(lost.state, 'unknown');
  assert.match(lost.message, /Saved status unknown/);

  const reloaded = createPendingStore({ getStorage: () => storage, scope: 'live:u1:c1' });
  assert.equal(reloaded.load(), null, 'private body never survives reload');
  assert.equal(reloaded.interrupted(), true);
  assert.equal(storage.getItem(reloaded.key), '1', 'marker contains no private fields');
  const pending = original.load();
  assert.deepEqual(pending.body, frozen.body);
  assert.ok(Object.isFrozen(pending.body));
  assert.equal(createPendingStore({ getStorage: () => storage, scope: 'live:u2:c1' }).interrupted(), false);

  const replay = { status: 200, data: { resource: { id: 'a1', revision: 1, archived: false }, committed_revision: 1, request_id: frozen.body.request_id, replayed: true, action: 'create' } };
  const second = fakeApi({ outcomes: [replay] });
  const retried = await submitFrozen({ api: second, frozen: pending, store: original, retry: true });
  assert.equal(retried.state, 'confirmed');
  assert.deepEqual(second.sent[0].data, first.sent[0].data, 'retry resends exactly the frozen body');
  assert.equal(second.sent[0].url, first.sent[0].url);
  assert.equal(original.load(), null, 'cleared only after the authoritative response');
  assert.equal(reloaded.interrupted(), false);
  assert.equal(replayNotice(retried.data), 'This save had already finished. Nothing was added twice.');
});

test('5xx, 401 and still-offline retries keep the frozen request; nothing retries automatically', async () => {
  const storage = fakeStorage();
  const store = createPendingStore({ getStorage: () => storage, scope: 'live:u1:c1' });
  const frozen = frozenCreate();
  const api = fakeApi({ outcomes: [httpError(503), httpError(401), httpError(500)] });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await submitFrozen({ api, frozen, store, retry: attempt > 0 });
    assert.equal(result.state, 'unknown');
    assert.ok(store.load());
  }
  assert.equal(api.sent.length, 3, 'one send per explicit call');
  assert.ok(api.sent.every((sent) => sent.data.request_id === frozen.body.request_id));
  const offline = await submitFrozen({ api: fakeApi({ capability: networkError() }), frozen, store, retry: true });
  assert.equal(offline.state, 'unknown');
  assert.ok(store.load());
  const older = await submitFrozen({ api: fakeApi({ capability: httpError(404) }), frozen, store, retry: true });
  assert.equal(older.state, 'unknown', 'a pending save stays unresolved if the backend stops advertising the contract');
  assert.ok(store.load());
});

test('authoritative refusals resolve the pending save; denial is distinct from uncertainty', async () => {
  const cases = [
    [httpError(409, { error: 'This activity changed elsewhere. Reload before saving', code: 'revision_conflict' }), 'conflict', 'revision_conflict'],
    [httpError(409, { error: 'This request id was already used for a different change', code: 'request_mismatch' }), 'conflict', 'request_mismatch'],
    [httpError(409, { error: 'Outside activity logging is turned off by the client', code: 'collection_off' }), 'conflict', 'collection_off'],
    [httpError(404, { error: 'Activity not found' }), 'denied', undefined],
    [httpError(403, { error: 'Coach access required' }), 'denied', undefined],
  ];
  for (const [error, state, code] of cases) {
    const storage = fakeStorage();
    const store = createPendingStore({ getStorage: () => storage, scope: 'live:u1:c1' });
    store.save(frozenCreate());
    const result = await submitFrozen({ api: fakeApi({ outcomes: [error] }), frozen: store.load(), store, retry: true });
    assert.equal(result.state, state, error.message);
    if (code) assert.equal(result.code, code);
    assert.equal(store.load(), null);
  }
  const denied = classifyFailure(httpError(404, { error: 'Client week not found' }));
  assert.doesNotMatch(denied.message, /unknown/i);
  assert.match(classifyFailure(networkError()).message, /unknown/i);
});

test('a replayed older receipt never replaces a newer row', () => {
  const rows = [
    { id: 'a1', occurred_on: '2026-03-04', created_at: '2026-03-04T10:00:00Z', revision: 3, duration_seconds: 2400 },
    { id: 'b2', occurred_on: '2026-03-02', created_at: '2026-03-02T10:00:00Z', revision: 1 },
  ];
  assert.equal(mergeActivity(rows, { id: 'a1', occurred_on: '2026-03-04', revision: 2, duration_seconds: 1800 }), rows);
  const newer = mergeActivity(rows, { id: 'a1', occurred_on: '2026-03-04', created_at: '2026-03-04T10:00:00Z', revision: 4, duration_seconds: 3000 });
  assert.equal(newer.find((row) => row.id === 'a1').duration_seconds, 3000);
  assert.deepEqual(newer.map((row) => row.id), ['b2', 'a1'], 'sorted by Denver date');
  assert.deepEqual(mergeActivity(rows, { id: 'b2', revision: 2, archived: true }).map((row) => row.id), ['a1']);
  assert.match(replayNotice({ replayed: true, committed_revision: 1, resource: { revision: 3 } }), /changed since/);
  assert.equal(replayNotice({ replayed: false, committed_revision: 1, resource: { revision: 1 } }), null);
});

test('corrupt or foreign storage records are ignored, never sent', () => {
  const storage = fakeStorage();
  const store = createPendingStore({ getStorage: () => storage, scope: 'live:u1:c1' });
  storage.setItem(store.key, '{not json');
  assert.equal(store.load(), null);
  storage.setItem(store.key, JSON.stringify({ kind: 'delete', method: 'delete', url: '/x', body: { request_id: 'r' } }));
  assert.equal(store.load(), null);
  const blocked = createPendingStore({ getStorage: () => { throw new Error('blocked'); }, scope: 'x' });
  assert.equal(blocked.save(frozenCreate()), true);
  assert.ok(blocked.load(), 'blocked storage does not prevent a private in-memory retry');
});
