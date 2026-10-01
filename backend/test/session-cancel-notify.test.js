const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const COACH_ID = 'aaaaaaaa-0000-0000-0000-00000000000a';
const CLIENT_ID = 'cccccccc-0000-0000-0000-00000000000c';
const SESSION_ID = 'eeeeeeee-0000-0000-0000-00000000000e';
const FUTURE = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

const state = {};
function resetState() {
  state.sessionRow = { id: SESSION_ID, client_id: CLIENT_ID, coach_id: COACH_ID, scheduled_at: FUTURE, duration_minutes: 60, status: 'scheduled', archived: false };
  state.updates = [];
  state.emails = 0;
  state.pushes = 0;
}

const supabasePath = require.resolve('../src/supabase');
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: {
    supabaseAdmin: {
      from() {
        const chain = {
          _update: null,
          select() { return chain; },
          eq() { return chain; },
          update(values) { chain._update = values; state.updates.push(values); return chain; },
          maybeSingle() { return Promise.resolve({ data: state.sessionRow, error: null }); },
          single() { return Promise.resolve({ data: { ...state.sessionRow, ...(chain._update || {}), client: { id: CLIENT_ID, name: 'Client' } }, error: null }); },
        };
        return chain;
      },
      rpc() { return Promise.resolve({ data: null, error: null }); },
    },
  },
};
const authPath = require.resolve('../src/middleware/auth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    requireAuth: (req, _res, next) => { req.user = { role: 'coach', coach: { id: COACH_ID, name: 'Coach' } }; next(); },
    requireCoach: (_req, _res, next) => next(),
    requireClient: (_req, res) => res.status(403).json({ error: 'no' }),
    canAccessClient: () => true,
  },
};
const emailPath = require.resolve('../src/services/email');
require.cache[emailPath] = {
  id: emailPath, filename: emailPath, loaded: true,
  exports: {
    dispatchEmail: (task) => Promise.resolve().then(task),
    notifySessionCancelled: () => { state.emails += 1; return Promise.resolve({}); },
    notifySessionScheduled: () => Promise.resolve({}),
    notifySessionRescheduled: () => Promise.resolve({}),
    notifySessionCancelledByClient: () => Promise.resolve({}),
    notifySessionCancelRequested: () => Promise.resolve({}),
    formatDenver: () => 'formatted',
  },
};
const pushPath = require.resolve('../src/services/push');
require.cache[pushPath] = {
  id: pushPath, filename: pushPath, loaded: true,
  exports: {
    dispatchPush: () => { state.pushes += 1; return {}; },
    sendToClient: () => Promise.resolve({}),
    sendToCoaches: () => Promise.resolve({}),
  },
};

const express = require('express');
const { validateNotifyFlag } = require('../src/validation/business');
const app = express();
app.use(express.json());
app.use('/api/sessions', require('../src/routes/sessions'));
const server = http.createServer(app);
let baseUrl;
test.before(async () => { await new Promise((r) => { server.listen(0, '127.0.0.1', r); }); baseUrl = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); });

async function cancel(body) {
  const response = await fetch(`${baseUrl}/api/sessions/${SESSION_ID}/cancel`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test('cancel without a body still notifies (default preserved)', async () => {
  resetState();
  const result = await cancel(undefined);
  assert.equal(result.status, 200);
  assert.equal(state.emails, 1);
  assert.equal(state.pushes, 1);
});

test('cancel with notify true notifies; notify false is silent but still cancels', async () => {
  resetState();
  assert.equal((await cancel({ notify: true })).status, 200);
  assert.equal(state.emails, 1);
  resetState();
  const quiet = await cancel({ notify: false });
  assert.equal(quiet.status, 200);
  assert.equal(quiet.body.status, 'cancelled');
  assert.equal(state.emails, 0);
  assert.equal(state.pushes, 0);
  assert.ok(state.updates.some((update) => update.status === 'cancelled'));
});

test('a non-boolean notify is rejected before anything changes', async () => {
  resetState();
  const result = await cancel({ notify: 'no' });
  assert.equal(result.status, 400);
  assert.equal(state.updates.length, 0);
  assert.equal(state.emails, 0);
});

test('validateNotifyFlag defaults to true and accepts only booleans', () => {
  assert.deepEqual(validateNotifyFlag(undefined), { ok: true, value: true });
  assert.deepEqual(validateNotifyFlag({}), { ok: true, value: true });
  assert.deepEqual(validateNotifyFlag({ notify: false }), { ok: true, value: false });
  assert.equal(validateNotifyFlag({ notify: 1 }).ok, false);
  assert.equal(validateNotifyFlag({ notify: null }).ok, false);
});
