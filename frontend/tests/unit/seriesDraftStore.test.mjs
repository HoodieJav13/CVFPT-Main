import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftStore, newRequestId } from '../../src/lib/seriesDraftStore.js';

function fakeStorage(options = {}) {
  const map = new Map();
  return {
    map,
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] ?? null; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { if (options.failSet) throw new DOMException('blocked', 'QuotaExceededError'); map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
  };
}
const record = (id = 'req-1') => ({ request_id: id, body: { client_id: 'c1', slots: [{ key: 'g1' }] }, state: 'pending' });

test('save then load round-trips the frozen request, scoped to user and client', () => {
  const storage = fakeStorage();
  const store = createDraftStore({ getStorage: () => storage, userId: 'coach-1' });
  assert.equal(store.save('client-1', record()), true);
  assert.equal(store.load('client-1').request_id, 'req-1');
  assert.deepEqual(store.load('client-1').body.slots, [{ key: 'g1' }]);
  assert.equal(store.load('client-2'), null);
  const otherUser = createDraftStore({ getStorage: () => storage, userId: 'coach-2' });
  assert.equal(otherUser.load('client-1'), null); // never leaks across users
  assert.ok([...storage.map.keys()][0].startsWith('cvf_series_pending:coach-1:client-1'));
});

test('an editor snapshot saved with the request survives the round trip (versioned, optional)', () => {
  const storage = fakeStorage();
  const store = createDraftStore({ getStorage: () => storage, userId: 'u' });
  const draft = { v: 1, config: { weekdays: [2] }, rows: [{ key: 'g1', selected: false }], pins: { g1: 'w1' }, ruleUsed: { start_date: '2031-06-03' } };
  assert.equal(store.save('c', { ...record(), draft }), true);
  assert.deepEqual(store.load('c').draft, draft);
  store.save('c2', record()); // records written without a snapshot still load
  assert.equal(store.load('c2').draft, undefined);
  assert.equal(store.findPending().record.request_id !== undefined, true);
});

test('findPending locates the user\'s unresolved save without knowing the client', () => {
  const storage = fakeStorage();
  const store = createDraftStore({ getStorage: () => storage, userId: 'coach-1' });
  assert.equal(store.findPending(), null);
  storage.setItem('unrelated', 'x');
  createDraftStore({ getStorage: () => storage, userId: 'coach-2' }).save('client-9', record('other'));
  store.save('client-1', record('mine'));
  const pending = store.findPending();
  assert.equal(pending.clientId, 'client-1');
  assert.equal(pending.record.request_id, 'mine');
});

test('clear removes only that client\'s record', () => {
  const storage = fakeStorage();
  const store = createDraftStore({ getStorage: () => storage, userId: 'u' });
  store.save('a', record('1')); store.save('b', record('2'));
  store.clear('a');
  assert.equal(store.load('a'), null);
  assert.equal(store.load('b').request_id, '2');
});

test('STORAGE UNAVAILABLE: a throwing storage accessor never throws and save reports false', () => {
  const store = createDraftStore({ getStorage: () => { throw new Error('SecurityError'); }, userId: 'u' });
  assert.equal(store.save('c', record()), false);
  assert.equal(store.load('c'), null);
  assert.equal(store.findPending(), null);
  assert.doesNotThrow(() => store.clear('c'));
});

test('STORAGE UNAVAILABLE: missing storage (null) and a full/blocked setItem report false and stay quiet', () => {
  assert.equal(createDraftStore({ getStorage: () => null, userId: 'u' }).save('c', record()), false);
  const blocked = createDraftStore({ getStorage: () => fakeStorage({ failSet: true }), userId: 'u' });
  assert.equal(blocked.save('c', record()), false);
  assert.equal(blocked.load('c'), null);
});

test('corrupt or foreign values are ignored', () => {
  const storage = fakeStorage();
  const store = createDraftStore({ getStorage: () => storage, userId: 'u' });
  storage.setItem('cvf_series_pending:u:c1', '{not json');
  storage.setItem('cvf_series_pending:u:c2', JSON.stringify({ request_id: 5, body: 'x' }));
  storage.setItem('cvf_series_pending:u:c3', JSON.stringify({ request_id: 'ok', body: { a: 1 } }));
  assert.equal(store.load('c1'), null);
  assert.equal(store.load('c2'), null);
  assert.equal(store.findPending().clientId, 'c3');
});

test('newRequestId returns distinct UUIDs', () => {
  const a = newRequestId(); const b = newRequestId();
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(a, b);
});
