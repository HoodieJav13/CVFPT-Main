import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let compilation = 0;
const settle = () => new Promise(resolve => setImmediate(resolve));
const coach = { role: 'coach', email: 'fictional@example.invalid', profile: {} };

// Execute the actual provider with hook/API doubles, preserving async auth logic.
// No browser credentials, app backend or analytics transport are involved.
async function provider(run) {
  const oldWindow = globalThis.window;
  const states = [], roles = [], gets = [], posts = [], timers = [], tokenWrites = [];
  let effect;
  const defer = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
  };
  const tokenStore = { access: 'fictional-token', clear() { this.access = null; },
    set(access, refresh) { tokenWrites.push([access, refresh]); this.access = access; } };
  globalThis.window = { location: { pathname: '/coach', href: '' }, setTimeout(fn) { timers.push(fn); } };
  globalThis.authReviewHarness = {
    createContext: () => ({}), useContext: () => ({}), useCallback: fn => fn,
    useRef: value => ({ current: value }),
    useState: value => { const index = states.length; states.push(value); return [value, next => { states[index] = next; }]; },
    useEffect: fn => { effect = fn; }, isPreviewMode: false, previewReady: Promise.resolve(null), tokenStore,
    setCoachAnalyticsRole: role => roles.push(role ?? null),
    api: { get: () => { const request = defer(); gets.push(request); return request.promise; },
      post: () => { const request = defer(); posts.push(request); return request.promise; } },
  };
  const source = (await readFile(new URL('../../src/context/AuthContext.jsx', import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '')
    .replace(/return \(\s*<AuthContext.Provider[\s\S]*?<\/AuthContext.Provider>\s*\);/,
      'return { login, signup, logout, reload: loadMe };');
  assert.equal(source.includes('<AuthContext.Provider'), false);
  const prelude = 'const {createContext,useContext,useCallback,useRef,useState,useEffect,isPreviewMode,previewReady,tokenStore,setCoachAnalyticsRole,api}=globalThis.authReviewHarness;\n';
  try {
    const module = await import(`data:text/javascript;base64,${Buffer.from(prelude + source).toString('base64')}#${++compilation}`);
    const controls = module.AuthProvider({ children: null });
    const cleanup = effect();
    await run({ controls, cleanup, states, roles, gets, posts, timers, tokenStore, tokenWrites });
  } finally {
    delete globalThis.authReviewHarness;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
  }
}

test('pending /auth/me cannot restore coach state or analytics after logout before navigation', async () => {
  await provider(async ({ controls, states, roles, gets, tokenStore }) => {
    gets[0].resolve({ data: coach }); await settle();
    assert.equal(states[0].role, 'coach');
    const pending = controls.reload();
    controls.logout();
    assert.equal(states[0], null);
    gets[1].resolve({ data: coach }); await pending;
    assert.equal(states[0], null);
    assert.equal(roles.at(-1), null);
    assert.equal(tokenStore.access, null);
    assert.equal(window.location.href, '/login');
  });
});

test('pending login/signup preserve their result but cannot restore tokens or analytics after logout', async () => {
  for (const action of ['login', 'signup']) {
    await provider(async ({ controls, states, roles, posts, tokenWrites, tokenStore }) => {
      const pending = controls[action]('fictional@example.invalid', 'fictional-password');
      controls.logout();
      const data = { ...coach, access_token: 'fictional-new-token', refresh_token: 'fictional-refresh' };
      posts[0].resolve({ data });
      assert.equal(await pending, data);
      assert.equal(states[0], null);
      assert.equal(roles.at(-1), null);
      assert.deepEqual(tokenWrites, []);
      assert.equal(tokenStore.access, null);
    });
  }
});

test('outdated /auth/me response cannot replace a newer role verdict', async () => {
  await provider(async ({ controls, states, roles, gets }) => {
    const newer = controls.reload();
    gets[1].resolve({ data: { ...coach, role: 'client' } }); await newer;
    gets[0].resolve({ data: coach }); await settle();
    assert.equal(states[0].role, 'client');
    assert.equal(roles.at(-1), 'client');
  });
});

test('current login/signup finish loading when superseding the initial auth request', async () => {
  for (const action of ['login', 'signup']) {
    await provider(async ({ controls, states, roles, gets, posts, tokenStore }) => {
      const pending = controls[action]('fictional@example.invalid', 'fictional-password');
      const data = { ...coach, role: 'client', access_token: 'fictional-new-token', refresh_token: 'fictional-refresh' };
      posts[0].resolve({ data });
      assert.equal(await pending, data);
      gets[0].resolve({ data: coach }); await settle();
      assert.equal(states[0].role, 'client');
      assert.equal(states[1], false);
      assert.equal(roles.at(-1), 'client');
      assert.equal(tokenStore.access, data.access_token);
    });
  }
});

test('current failed login/signup finish loading and preserve the original rejection', async () => {
  for (const action of ['login', 'signup']) {
    await provider(async ({ controls, states, roles, gets, posts }) => {
      const error = new Error('fictional auth rejection');
      const pending = controls[action]('fictional@example.invalid', 'fictional-password');
      posts[0].reject(error);
      await assert.rejects(pending, actual => actual === error);
      gets[0].resolve({ data: coach }); await settle();
      assert.equal(states[0], null);
      assert.equal(states[1], false);
      assert.equal(roles.at(-1), null);
    });
  }
});

test('scheduled auth retries are discarded after logout and stale failures do not schedule retries', async () => {
  await provider(async ({ controls, gets, timers, roles }) => {
    gets[0].reject(new Error('fictional network failure')); await settle();
    assert.equal(timers.length, 1);
    controls.logout();
    await timers[0]();
    assert.equal(gets.length, 1);
    assert.equal(roles.at(-1), null);
  });
  await provider(async ({ controls, gets, timers }) => {
    controls.logout();
    gets[0].reject(new Error('fictional network failure')); await settle();
    assert.equal(timers.length, 0);
  });
});

test('pending auth response cannot update state or analytics after provider unmount', async () => {
  await provider(async ({ cleanup, gets, states, roles }) => {
    cleanup();
    gets[0].resolve({ data: coach }); await settle();
    assert.equal(states[0], null);
    assert.deepEqual(roles, [null]);
  });
});
