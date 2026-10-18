import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from 'vite';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MODE = 'quick-400-once';
const REJECTION = 'Simulated Quick validation rejection (preview)';
let compilation = 0;

async function runtime(vercel = 'preview') {
  const previous = process.env.VERCEL_ENV;
  let config;
  try {
    process.env.VERCEL_ENV = vercel;
    config = await resolveConfig({ root: ROOT, logLevel: 'silent' }, 'build', 'production');
  } finally {
    if (previous === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous;
  }
  const output = await build({
    entryPoints: [`${ROOT}/src/lib/previewMode.js`],
    bundle: true, platform: 'node', format: 'esm', write: false,
    alias: { '@': `${ROOT}/src` },
    define: {
      'import.meta.env.DEV': 'false',
      // Hostile opt-in values cannot override the Production build's defines.
      'import.meta.env.REACT_APP_PREVIEW_MODE': config.define['import.meta.env.REACT_APP_PREVIEW_MODE'] || '"true"',
      'import.meta.env.REACT_APP_HOSTED_DEMO': config.define['import.meta.env.REACT_APP_HOSTED_DEMO'] || '"false"',
    },
  });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}#${++compilation}`);
}

async function withStorage(run) {
  const previous = ['window', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const data = new Map([['cvf_preview_role', 'coach']]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
    key: index => [...data.keys()][index] ?? null,
    get length() { return data.size; },
  } });
  try { await run(data); }
  finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

const body = requestId => ({ request_id: requestId, client_id: 'client_riley',
  assigned_for: '2026-10-18', name: 'Fictional 400 probe',
  exercises: [{ custom_name: 'Fictional movement', sets: '3', reps: '8' }] });

function request(api, method, url, data) {
  return api.defaults.adapter({ method, url, data }).catch(error => error.response);
}

test('Quick 400 is exact-path, one-shot, and rejects before fixture mutation', async () => {
  await withStorage(async data => {
    const module = await runtime();
    const api = { defaults: {} };
    module.installPreviewApi(api);
    const before = await request(api, 'get', '/programs/workouts');
    module.setPreviewFailMode(MODE);
    // A read, auth call, different save, and a child Quick route must not consume it.
    assert.equal((await request(api, 'get', '/auth/me')).status, 200);
    assert.equal((await request(api, 'post', '/telemetry/events', {})).status, 202);
    assert.equal((await request(api, 'post', '/programs/workouts', { name: 'Unrelated fixture', exercises: [] })).status, 201);
    assert.equal((await request(api, 'post', '/programs/quick-sessions/quick_assign_riley_today/save-to-library', {})).status, 201);
    assert.equal(data.get('cvf_preview_fail'), MODE);
    const afterUnrelated = await request(api, 'get', '/programs/workouts');
    const assignments = await request(api, 'get', '/programs/workout-assignments/client/client_riley');
    const id = '40000000-0000-4000-8000-000000000001';
    const failed = await request(api, 'post', '/programs/quick-sessions', body(id));
    assert.equal(failed.status, 400);
    assert.deepEqual(failed.data, { error: REJECTION });
    assert.equal(data.has('cvf_preview_fail'), false);
    assert.deepEqual((await request(api, 'get', '/programs/workouts')).data, afterUnrelated.data);
    assert.deepEqual((await request(api, 'get', '/programs/workout-assignments/client/client_riley')).data, assignments.data);
    assert.equal((await request(api, 'get', `/programs/quick-sessions/requests/${id}`)).status, 404);
    assert.equal((await request(api, 'post', '/programs/quick-sessions', body(id))).status, 201);
    assert.ok(afterUnrelated.data.length > before.data.length);
  });
});

test('concurrent Quick posts consume the 400 switch exactly once', async () => {
  await withStorage(async () => {
    const module = await runtime();
    const api = { defaults: {} };
    module.installPreviewApi(api);
    module.setPreviewFailMode(MODE);
    const ids = ['40000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000003'];
    const results = await Promise.all(ids.map(id => request(api, 'post', '/programs/quick-sessions', body(id))));
    assert.deepEqual(results.map(result => result.status).sort(), [201, 400]);
    assert.equal(module.getPreviewFailMode(), 'off');
  });
});

test('Production and non-fixture builds leave the real adapter and storage untouched', async () => {
  await withStorage(async data => {
    data.set('cvf_preview_fail', MODE);
    for (const environment of ['production', '']) {
      const module = await runtime(environment);
      assert.equal(module.isPreviewMode, false);
      const original = () => 'real adapter sentinel';
      const api = { defaults: { adapter: original } };
      const before = [...data];
      module.installPreviewApi(api);
      assert.equal(api.defaults.adapter, original);
      assert.deepEqual([...data], before);
    }
  });
});
