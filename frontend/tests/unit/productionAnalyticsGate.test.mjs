import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from 'vite';
import { build } from 'esbuild';

let compilation = 0;
async function compileRuntime({ vercel = 'production', requestedMode, fixtures = false,
  host = 'https://us.i.posthog.com', token = 'phc_FICTIONAL' } = {}) {
  const oldVercel = process.env.VERCEL_ENV;
  let config;
  try {
    process.env.VERCEL_ENV = vercel;
    config = await resolveConfig({ root: fileURLToPath(new URL('../../', import.meta.url)), logLevel: 'silent' }, 'build', 'production');
  } finally {
    if (oldVercel === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = oldVercel;
  }
  assert.equal(config.define.__CVF_POSTHOG_PREVIEW_ALLOWED__, vercel === 'preview' ? 'true' : 'false');
  assert.equal(config.define.__CVF_POSTHOG_PRODUCTION_ALLOWED__, vercel === 'production' ? 'true' : 'false');
  if (vercel === 'production') {
    assert.equal(config.define['import.meta.env.REACT_APP_PREVIEW_MODE'], '"false"');
    assert.equal(config.define['import.meta.env.REACT_APP_HOSTED_DEMO'], '"false"');
  }
  const source = (await readFile(new URL('../../src/lib/coachAnalytics.js', import.meta.url), 'utf8'))
    .replace("import { isPreviewMode } from './previewFlag';", `const isPreviewMode = ${fixtures};`);
  const output = await build({
    stdin: { contents: source, resolveDir: fileURLToPath(new URL('../../src/lib', import.meta.url)), loader: 'js' },
    bundle: true, platform: 'node', format: 'esm', write: false,
    define: {
      __CVF_POSTHOG_PREVIEW_ALLOWED__: config.define.__CVF_POSTHOG_PREVIEW_ALLOWED__,
      __CVF_POSTHOG_PRODUCTION_ALLOWED__: config.define.__CVF_POSTHOG_PRODUCTION_ALLOWED__,
      'import.meta.env.REACT_APP_POSTHOG_MODE': JSON.stringify(requestedMode ?? ''),
      'import.meta.env.REACT_APP_POSTHOG_HOST': JSON.stringify(host),
      'import.meta.env.REACT_APP_POSTHOG_PUBLIC_TOKEN': JSON.stringify(token),
    },
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}#${++compilation}`);
}

async function intercepted(run) {
  const oldFetch = globalThis.fetch;
  const oldWindow = globalThis.window;
  const storage = ['localStorage', 'sessionStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const requests = [];
  const target = new EventTarget();
  target.location = { pathname: '/coach/sessions' };
  let listenerCount = 0;
  const addListener = target.addEventListener.bind(target);
  target.addEventListener = (...args) => { listenerCount += 1; addListener(...args); };
  globalThis.window = target;
  globalThis.fetch = async (url, options) => { requests.push({ url, options, body: JSON.parse(options.body) }); return { ok: true }; };
  for (const [key] of storage) Object.defineProperty(globalThis, key, { configurable: true, get() { throw Error('analytics accessed persistent storage'); } });
  try { await run({ requests, target, listeners: () => listenerCount }); }
  finally {
    globalThis.fetch = oldFetch;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    for (const [key, descriptor] of storage) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
}

async function allEvents(module, target) {
  module.trackCoachScreen('/coach/sessions');
  module.reportCoachError('/coach/sessions', 'render');
  module.listenForCoachErrors(target, () => '/coach/sessions')();
  const result = { data: { id: 'fictional' } };
  assert.equal(await module.observeCoachSessionSave(() => result, { operation: 'create', workout_change: 'none' }), result);
}

test('compiled production remains off by default/rollback; fixtures and other builds cannot enable live capture', async () => {
  await intercepted(async ({ requests, target, listeners }) => {
    for (const input of [
      {}, { requestedMode: 'off' }, { requestedMode: 'local', fixtures: true },
      { requestedMode: 'synthetic-preview', fixtures: true },
      { requestedMode: 'production-coach', fixtures: true },
      { requestedMode: 'production-coach', vercel: '' },
      { requestedMode: 'production-coach', vercel: 'preview' },
      { requestedMode: 'production-coach', token: '' },
      { requestedMode: 'production-coach', token: 'phx_ACCOUNT' },
      { requestedMode: 'production-coach', host: 'https://eu.i.posthog.com' },
    ]) {
      const module = await compileRuntime(input);
      module.setCoachAnalyticsRole('coach');
      await allEvents(module, target);
      assert.equal(requests.length, 0);
      assert.equal(listeners(), 0);
    }
  });
});

test('compiled explicit production mode emits only authenticated-coach safe events and discards stale results', async () => {
  await intercepted(async ({ requests, target }) => {
    const module = await compileRuntime({ requestedMode: 'production-coach' });
    for (const role of [null, 'client', 'admin', 'unknown']) {
      module.setCoachAnalyticsRole(role);
      await allEvents(module, target);
    }
    assert.equal(requests.length, 0);
    module.setCoachAnalyticsRole('coach');
    for (const path of ['/client/sessions', '/admin', '/login', '/reset-password?token=PRIVATE', '/coach/clients/x/notes']) {
      module.trackCoachScreen(path); module.reportCoachError(path, 'runtime');
    }
    assert.equal(requests.length, 0);
    module.trackCoachScreen('/coach/clients/PRIVATE?token=PRIVATE');
    const remove = module.listenForCoachErrors(target, () => '/coach/sessions/PRIVATE');
    target.dispatchEvent(new Event('error'));
    remove();
    await module.observeCoachSessionSave(() => ({ data: { client_id: 'PRIVATE', message: 'PRIVATE' } }),
      { operation: 'create', workout_change: 'attached', client_id: 'PRIVATE' });
    assert.equal(requests.length, 3);
    const originalId = requests[0].body.distinct_id;
    assert.match(originalId, /^[0-9a-f-]{36}$/i);
    assert.equal(requests.every(r => r.body.distinct_id === originalId), true);
    assert.equal(JSON.stringify(requests).includes('PRIVATE'), false);
    target.location.pathname = '/login';
    await allEvents(module, target);
    assert.equal(requests.length, 3);
    target.location.pathname = '/coach/sessions';
    let resolveSave;
    const pending = module.observeCoachSessionSave(() => new Promise(resolve => { resolveSave = resolve; }),
      { operation: 'update', workout_change: 'none' });
    module.setCoachAnalyticsRole(null);
    module.setCoachAnalyticsRole('coach');
    resolveSave({ data: { id: 'PRIVATE' } });
    await pending;
    assert.equal(requests.length, 3);
    module.trackCoachScreen('/coach/sessions');
    assert.notEqual(requests.at(-1).body.distinct_id, originalId);
    module.setCoachAnalyticsRole('client');
    await allEvents(module, target);
    assert.equal(requests.length, 4);
  });
});

test('a fresh compiled page gets a different UUID with no persistent analytics storage', async () => {
  await intercepted(async ({ requests }) => {
    for (let boot = 0; boot < 2; boot += 1) {
      const module = await compileRuntime({ requestedMode: 'production-coach' });
      module.setCoachAnalyticsRole('coach');
      module.trackCoachScreen('/coach');
    }
    assert.equal(requests.length, 2);
    assert.notEqual(requests[0].body.distinct_id, requests[1].body.distinct_id);
  });
});
