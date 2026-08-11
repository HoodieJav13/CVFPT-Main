// Program 011 D: ask-to-cancel notifications (recipients, idempotence,
// email) and the coach messages-off flag (send refusal, own-only toggle).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const COACH_ID = 'aaaaaaaa-0000-0000-0000-00000000000a';
const ADMIN_ID = 'abababab-0000-0000-0000-00000000000b';
const CLIENT_ID = 'cccccccc-0000-0000-0000-00000000000c';
const SESSION_ID = 'eeeeeeee-0000-0000-0000-00000000000e';

const state = {
  sessionRow: null,
  coachRow: { messages_disabled: false },
  notificationInserts: [],
  duplicateInsert: false,
  cancelRequestEmails: 0,
  coachUpdates: [],
};

function resetState() {
  state.sessionRow = null;
  state.coachRow = { messages_disabled: false };
  state.notificationInserts = [];
  state.duplicateInsert = false;
  state.cancelRequestEmails = 0;
  state.coachUpdates = [];
}

const supabasePath = require.resolve('../src/supabase');
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: {
    supabaseAdmin: {
      from(table) {
        const chain = {
          select() { return chain; },
          eq() { return chain; },
          or() { return chain; },
          order() { return chain; },
          insert(values) {
            if (table === 'notifications') {
              state.notificationInserts.push(values);
              if (state.duplicateInsert) return { select: () => chain, then: (resolve) => resolve({ data: null, error: { code: '23505', message: 'duplicate' } }) };
              return { then: (resolve) => resolve({ data: values, error: null }), select: () => chain };
            }
            chain._insert = values; return chain;
          },
          update(values) { chain._update = values; if (table === 'coaches') state.coachUpdates.push(values); return chain; },
          maybeSingle() {
            if (table === 'sessions') return Promise.resolve({ data: state.sessionRow, error: null });
            if (table === 'coaches') return Promise.resolve({ data: state.coachRow, error: null });
            return Promise.resolve({ data: null, error: null });
          },
          single() {
            if (table === 'coaches') return Promise.resolve({ data: { messages_disabled: chain._update ? chain._update.messages_disabled : state.coachRow.messages_disabled }, error: null });
            if (table === 'messages' && chain._insert) return Promise.resolve({ data: { id: 'msg-1', ...chain._insert }, error: null });
            return Promise.resolve({ data: null, error: null });
          },
          then(resolve) {
            if (table === 'coaches') return resolve({ data: [{ id: COACH_ID }, { id: ADMIN_ID }], error: null });
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
    requireCoach: (req, res, next) => (['coach', 'admin'].includes(req.user?.role) ? next() : res.status(403).json({ error: 'Coach access required' })),
    requireClient: (req, res, next) => (req.user?.role === 'client' ? next() : res.status(403).json({ error: 'Client access required' })),
    canAccessClient: () => true,
  },
};

const emailPath = require.resolve('../src/services/email');
require.cache[emailPath] = {
  id: emailPath, filename: emailPath, loaded: true,
  exports: {
    dispatchEmail: (task) => Promise.resolve().then(task),
    notifySessionCancelRequested: () => { state.cancelRequestEmails += 1; return Promise.resolve({}); },
    notifySessionCancelled: () => Promise.resolve({}),
    notifySessionCancelledByClient: () => Promise.resolve({}),
    notifySessionRescheduled: () => Promise.resolve({}),
    notifySessionScheduled: () => Promise.resolve({}),
  },
};

const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/sessions', require('../src/routes/sessions'));
app.use('/api/messages', require('../src/routes/messages'));
const server = http.createServer(app);
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); });

async function send(pathname, { method = 'PATCH', body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method, headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const clientUser = { role: 'client', client: { id: CLIENT_ID, coach_id: COACH_ID } };
const coachUser = { role: 'coach', coach: { id: COACH_ID } };

test('ask-cancel notifies coach and admins and emails the coach', async () => {
  resetState();
  currentUser = clientUser;
  state.sessionRow = {
    id: SESSION_ID, client_id: CLIENT_ID, coach_id: COACH_ID, status: 'scheduled',
    scheduled_at: new Date(Date.now() + 2 * 3600 * 1000).toISOString(), archived: false,
  };
  const { status, body } = await send(`/api/sessions/${SESSION_ID}/ask-cancel`);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(state.notificationInserts.length, 2);
  assert.ok(state.notificationInserts.every((row) => row.event_type === 'cancel_requested' && row.session_id === SESSION_ID));
  assert.equal(state.cancelRequestEmails, 1);
});

test('asking twice is idempotent (duplicate inserts swallow as 23505)', async () => {
  resetState();
  currentUser = clientUser;
  state.duplicateInsert = true;
  state.sessionRow = {
    id: SESSION_ID, client_id: CLIENT_ID, coach_id: COACH_ID, status: 'scheduled',
    scheduled_at: new Date(Date.now() + 2 * 3600 * 1000).toISOString(), archived: false,
  };
  const { status } = await send(`/api/sessions/${SESSION_ID}/ask-cancel`);
  assert.equal(status, 200);
});

test('ask-cancel masks other clients\' sessions and refuses non-scheduled ones', async () => {
  resetState();
  currentUser = clientUser;
  state.sessionRow = null;
  let result = await send(`/api/sessions/${SESSION_ID}/ask-cancel`);
  assert.equal(result.status, 404);

  state.sessionRow = { id: SESSION_ID, client_id: CLIENT_ID, coach_id: COACH_ID, status: 'completed', archived: false };
  result = await send(`/api/sessions/${SESSION_ID}/ask-cancel`);
  assert.equal(result.status, 400);
  assert.equal(state.notificationInserts.length, 0);
});

test('client sends are refused while the coach has messages paused', async () => {
  resetState();
  currentUser = clientUser;
  state.coachRow = { messages_disabled: true };
  const result = await send('/api/messages/mine', { method: 'POST', body: { content: 'hey' } });
  assert.equal(result.status, 403);
  assert.match(result.body.error, /isn't taking messages/);

  state.coachRow = { messages_disabled: false };
  const allowed = await send('/api/messages/mine', { method: 'POST', body: { content: 'hey' } });
  assert.equal(allowed.status, 201);
});

test('availability toggle is coach-scoped and boolean-validated', async () => {
  resetState();
  currentUser = coachUser;
  let result = await send('/api/messages/availability', { method: 'PATCH', body: { messages_disabled: true } });
  assert.equal(result.status, 200);
  assert.equal(result.body.messages_disabled, true);
  assert.deepEqual(state.coachUpdates[0].messages_disabled, true);

  result = await send('/api/messages/availability', { method: 'PATCH', body: { messages_disabled: 'yes' } });
  assert.equal(result.status, 400);

  currentUser = clientUser;
  result = await send('/api/messages/availability', { method: 'PATCH', body: { messages_disabled: true } });
  assert.equal(result.status, 403);
});

test('migration widens notifications per-event and adds the pause flag', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260810220000_cancel_requests_and_messages_off.sql'), 'utf8');
  assert.match(migration, /messages_disabled boolean not null default false/);
  assert.match(migration, /'cancel_requested'/);
  assert.match(migration, /workout_log_id drop not null/);
  assert.match(migration, /uq_notifications_cancel_request/);
  assert.match(migration, /event_type = 'cancel_requested' and session_id is not null/);
});
