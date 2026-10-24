const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the real worker; only browser-owned fetch/CacheStorage are simulated.
const source = fs.readFileSync(path.join(__dirname, '../../frontend/sw.js'), 'utf8');
const png = fs.readFileSync(path.join(__dirname, '../../frontend/public/icons/apple-touch-icon.png'));
const image = () => new Response(png, { headers: { 'Content-Type': 'image/png' } });
const html = () => new Response('<!doctype html><title>SPA fallback</title>', { headers: { 'Content-Type': 'text/html' } });

function worker(network, seed) {
  const stores = new Map();
  const handlers = {};
  const key = (request) => typeof request === 'string' ? request : request.url;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async match(request) { return store.get(key(request))?.clone(); },
        async put(request, response) { store.set(key(request), response.clone()); },
        async delete(request) { return store.delete(key(request)); },
      };
    },
  };
  vm.runInNewContext(source, {
    self: { location: { origin: 'https://pt.test' }, addEventListener(name, handler) { handlers[name] = handler; } },
    caches, fetch: network, Response, URL,
  });
  return {
    async request(overrides = {}) {
      const request = { url: 'https://pt.test/icons/apple-touch-icon.png', method: 'GET', destination: 'image', mode: 'no-cors', ...overrides };
      const cache = await caches.open('cvf-static-__SW_VERSION__');
      if (seed) { await cache.put(request, seed); seed = null; }
      let response;
      handlers.fetch({ request, respondWith(value) { response = value; } });
      const value = await response;
      // Allow the background refresh's CacheStorage promise to settle.
      await new Promise((resolve) => setImmediate(resolve));
      return { response: value, cached: await cache.match(request) };
    },
  };
}

test('image request bypasses a cached HTML fallback on its first request', async () => {
  const { response, cached } = await worker(async () => image(), html()).request();
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  assert.equal(cached.headers.get('content-type'), 'image/png');
});

test('successful HTML image fallback is neither returned as an image nor cached', async () => {
  const { response, cached } = await worker(async () => html()).request();
  assert.equal(response.type, 'error');
  assert.equal(cached, undefined);
});

test('a poisoned image entry is removed even when the network is offline', async () => {
  const { response, cached } = await worker(async () => { throw new Error('offline'); }, html()).request();
  assert.equal(response.type, 'error');
  assert.equal(cached, undefined);
});

test('valid cached image remains available when offline', async () => {
  const { response } = await worker(async () => { throw new Error('offline'); }, image()).request();
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
});

test('a bad refresh does not replace an existing valid image', async () => {
  const { response, cached } = await worker(async () => html(), image()).request();
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  assert.equal(cached.headers.get('content-type'), 'image/png');
});

test('ordinary non-image static responses keep stale-while-revalidate behavior', async () => {
  const { response, cached } = await worker(async () => html()).request({ url: 'https://pt.test/offline-help', destination: '' });
  assert.equal(response.headers.get('content-type'), 'text/html');
  assert.equal(cached.headers.get('content-type'), 'text/html');
});

test('API, foreign-origin and non-GET traffic are not intercepted', async () => {
  for (const overrides of [{ url: 'https://pt.test/api/workouts' }, { url: 'https://other.test/icon.png' }, { method: 'POST' }]) {
    const { response } = await worker(async () => { throw new Error('must not fetch'); }).request(overrides);
    assert.equal(response, undefined);
  }
});
