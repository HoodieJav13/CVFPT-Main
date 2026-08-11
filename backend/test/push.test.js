// Program 012: push subscription routes, delivery service behavior
// (config gating, expired-endpoint self-archiving), and send-point wiring.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const USER_ID = 'dddddddd-0000-0000-0000-00000000000d';

const state = {
  upserts: [],
  updates: [],
  subscriptions: [],
  webPushCalls: [],
  webPushFail: null,
};

function resetState() {
  state.upserts = [];
  state.updates = [];
  state.subscriptions = [];
  state.webPushCalls = [];
  state.webPushFail = null;
}

const webPushPath = require.resolve('web-push');
require.cache[webPushPath] = {
  id: webPushPath, filename: webPushPath, loaded: true,
  exports: {
    setVapidDetails: () => {},
    sendNotification: (subscription, body) => {
      state.webPushCalls.push({ subscription, body });
      if (state.webPushFail) {
        const error = new Error('push failed');
        error.statusCode = state.webPushFail;
        return Promise.reject(error);
      }
      return Promise.resolve({});
    },
  },
};

const supabasePath = require.resolve('../src/supabase');
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: {
    supabaseAdmin: {
      from(table) {
        const chain = {
          select() { return chain; },
          eq() { return chain; },
          in() { return chain; },
          upsert(values, opts) { if (table === 'push_subscriptions') state.upserts.push({ values, opts }); return Promise.resolve({ data: values, error: null }); },
          update(values) { chain._update = values; if (table === 'push_subscriptions') state.updates.push(values); return chain; },
          maybeSingle() { return Promise.resolve({ data: null, error: null }); },
          then(resolve) {
            if (table === 'push_subscriptions') return resolve({ data: state.subscriptions, error: null });
            return resolve({ data: [], error: null });
          },
        };
        return chain;
      },
    },
  },
};

let currentUser;
const authPath = require.resolve('../src/middleware/auth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    requireAuth: (req, _res, next) => { req.user = currentUser; next(); },
    requireCoach: (_req, _res, next) => next(),
    requireClient: (_req, _res, next) => next(),
    canAccessClient: () => true,
  },
};

const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/push', require('../src/routes/push'));
const server = http.createServer(app);
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); });

async function send(pathname, { method = 'POST', body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method, headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const CONFIGURED_ENV = {
  VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:t@x.com',
};

test('public-key and subscribe answer honestly when unconfigured', async () => {
  resetState();
  currentUser = { role: 'client', client: { id: 'c' }, authUserId: USER_ID };
  delete process.env.VAPID_PUBLIC_KEY;
  const key = await send('/api/push/public-key', { method: 'GET' });
  assert.equal(key.body.public_key, null);
  const sub = await send('/api/push/subscribe', { body: { endpoint: 'https://push.example/x', keys: { p256dh: 'a', auth: 'b' } } });
  assert.equal(sub.status, 503);
});

test('subscribe validates and upserts by endpoint under the caller', async () => {
  resetState();
  currentUser = { role: 'client', client: { id: 'c' }, authUserId: USER_ID };
  process.env.VAPID_PUBLIC_KEY = 'pub';
  process.env.VAPID_PRIVATE_KEY = 'priv';
  process.env.VAPID_SUBJECT = 'mailto:t@x.com';
  let result = await send('/api/push/subscribe', { body: { endpoint: 'http://insecure', keys: { p256dh: 'a', auth: 'b' } } });
  assert.equal(result.status, 400);

  result = await send('/api/push/subscribe', { body: { endpoint: 'https://push.example/x', keys: { p256dh: 'a', auth: 'b' } } });
  assert.equal(result.status, 201);
  assert.equal(state.upserts[0].values.auth_user_id, USER_ID);
  assert.equal(state.upserts[0].opts.onConflict, 'endpoint');

  const unsub = await send('/api/push/unsubscribe', { body: { endpoint: 'https://push.example/x' } });
  assert.equal(unsub.status, 200);
  assert.ok(state.updates.some((update) => update.archived === true));
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
});

test('sendToUser skips when unconfigured and archives 410-expired endpoints', async () => {
  resetState();
  const { sendToUser } = require('../src/services/push');
  const skipped = await sendToUser(USER_ID, { title: 't' }, {});
  assert.deepEqual(skipped, { skipped: 'unconfigured' });
  assert.equal(state.webPushCalls.length, 0);

  state.subscriptions = [{ id: 's1', endpoint: 'https://push.example/x', p256dh: 'a', auth: 'b' }];
  state.webPushFail = 410;
  await sendToUser(USER_ID, { title: 't', body: 'b', url: '/x' }, CONFIGURED_ENV);
  assert.equal(state.webPushCalls.length, 1);
  assert.ok(state.updates.some((update) => update.archived === true));
});

test('every 011 signal moment has a push send point', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
  const workoutLogs = read('../src/routes/workoutLogs.js');
  const sessions = read('../src/routes/sessions.js');
  const bookings = read('../src/routes/bookings.js');
  const announcements = read('../src/routes/announcements.js');
  assert.match(workoutLogs, /In the gym now/);
  assert.match(workoutLogs, /completedWorkoutPush\(completed\)/);
  for (const marker of ['New session scheduled', 'Your session changed', 'Session cancelled', 'Cancel request']) {
    assert.match(sessions, new RegExp(marker));
  }
  for (const marker of ['New booking request', 'Session confirmed', 'Booking declined']) {
    assert.match(bookings, new RegExp(marker));
  }
  assert.match(announcements, /Studio announcement/);
  // Chat content never rides a push.
  assert.doesNotMatch(read('../src/routes/messages.js'), /dispatchPush|sendToClient|sendToCoaches/);
});

test('migration and service worker carry the push contract', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260811090000_push_subscriptions.sql'), 'utf8');
  assert.match(migration, /endpoint text not null unique/);
  assert.match(migration, /grant select, insert, update on table public\.push_subscriptions to service_role/);
  const sw = fs.readFileSync(path.join(__dirname, '../../frontend/sw.js'), 'utf8');
  assert.match(sw, /addEventListener\('push'/);
  assert.match(sw, /addEventListener\('notificationclick'/);
});
