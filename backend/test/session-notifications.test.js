// Mounted-route tests: coach session create/reschedule dispatch the client
// notification emails, and a no-op resave stays silent. Supabase, auth, and
// the email service are stubbed via the per-process require cache.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const COACH_ID = 'aaaaaaaa-0000-0000-0000-00000000000a';
const CLIENT_ID = 'cccccccc-0000-0000-0000-00000000000c';
const SESSION_ID = 'eeeeeeee-0000-0000-0000-00000000000e';
const BASE_TIME = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
const MOVED_TIME = new Date(Date.now() + 8 * 24 * 3600 * 1000).toISOString();

const state = {
  sessionRow: null,
  clientRow: null,
  readRow: null,
  scheduledCalls: [],
  rescheduledCalls: [],
  cancelledCalls: [],
};

function resetState() {
  state.sessionRow = null;
  state.clientRow = null;
  state.readRow = null;
  state.scheduledCalls = [];
  state.rescheduledCalls = [];
  state.cancelledCalls = [];
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
          order() { return chain; },
          update() { return chain; },
          maybeSingle() {
            if (table === 'sessions') return Promise.resolve({ data: state.sessionRow, error: null });
            if (table === 'clients') return Promise.resolve({ data: state.clientRow, error: null });
            return Promise.resolve({ data: null, error: null });
          },
          single() {
            if (table === 'sessions') return Promise.resolve({ data: state.readRow, error: null });
            return Promise.resolve({ data: null, error: null });
          },
        };
        return chain;
      },
      rpc(name) {
        if (name === 'schedule_session') {
          return Promise.resolve({ data: { outcome: 'scheduled', session: { id: SESSION_ID }, location_overlaps: 0 }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
    },
  },
};

const authPath = require.resolve('../src/middleware/auth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    requireAuth: (req, _res, next) => { req.user = { role: 'coach', coach: { id: COACH_ID } }; next(); },
    requireCoach: (_req, _res, next) => next(),
    requireClient: (_req, res) => res.status(403).json({ error: 'Client access required' }),
    requireAdmin: (_req, _res, next) => next(),
    canAccessClient: () => true,
  },
};

const emailPath = require.resolve('../src/services/email');
require.cache[emailPath] = {
  id: emailPath, filename: emailPath, loaded: true,
  exports: {
    dispatchEmail: (task) => Promise.resolve().then(task),
    notifySessionScheduled: (session) => { state.scheduledCalls.push(session); return Promise.resolve({}); },
    notifySessionRescheduled: (session, previous) => { state.rescheduledCalls.push({ session, previous }); return Promise.resolve({}); },
    notifySessionCancelled: (session) => { state.cancelledCalls.push(session); return Promise.resolve({}); },
  },
};

const express = require('express');
const sessionsRouter = require('../src/routes/sessions');

const app = express();
app.use(express.json());
app.use('/api/sessions', sessionsRouter);
const server = http.createServer(app);
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); });

async function send(path, body, method) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test('coach-created session emails the client', async () => {
  resetState();
  state.clientRow = { id: CLIENT_ID, coach_id: COACH_ID, archived: false };
  state.readRow = {
    id: SESSION_ID, client_id: CLIENT_ID, coach_id: COACH_ID, scheduled_at: BASE_TIME,
    duration_minutes: 60, location: 'Studio', status: 'scheduled',
  };
  const { status } = await send('/api/sessions', {
    client_id: CLIENT_ID, scheduled_at: BASE_TIME, duration_minutes: 60, location: 'Studio',
  }, 'POST');
  assert.equal(status, 201);
  assert.equal(state.scheduledCalls.length, 1);
  assert.equal(state.scheduledCalls[0].id, SESSION_ID);
  assert.equal(state.rescheduledCalls.length, 0);
});

test('rescheduling to a new time emails the client with old and new details', async () => {
  resetState();
  state.sessionRow = {
    id: SESSION_ID, client_id: CLIENT_ID, coach_id: COACH_ID, scheduled_at: BASE_TIME,
    duration_minutes: 60, location: 'Studio', status: 'scheduled', archived: false,
  };
  state.readRow = { ...state.sessionRow, scheduled_at: MOVED_TIME };
  const { status } = await send(`/api/sessions/${SESSION_ID}`, { scheduled_at: MOVED_TIME }, 'PUT');
  assert.equal(status, 200);
  assert.equal(state.rescheduledCalls.length, 1);
  assert.equal(state.rescheduledCalls[0].session.scheduled_at, MOVED_TIME);
  assert.equal(state.rescheduledCalls[0].previous.scheduled_at, BASE_TIME);
  assert.equal(state.scheduledCalls.length, 0);
});

test('a resave with unchanged time, duration, and location stays silent', async () => {
  resetState();
  state.sessionRow = {
    id: SESSION_ID, client_id: CLIENT_ID, coach_id: COACH_ID, scheduled_at: BASE_TIME,
    duration_minutes: 60, location: 'Studio', status: 'scheduled', archived: false,
  };
  state.readRow = { ...state.sessionRow };
  const { status } = await send(`/api/sessions/${SESSION_ID}`, { scheduled_at: BASE_TIME, duration_minutes: 60 }, 'PUT');
  assert.equal(status, 200);
  assert.equal(state.rescheduledCalls.length, 0);
  assert.equal(state.scheduledCalls.length, 0);
});

test('a duration or location change alone still notifies', async () => {
  resetState();
  state.sessionRow = {
    id: SESSION_ID, client_id: CLIENT_ID, coach_id: COACH_ID, scheduled_at: BASE_TIME,
    duration_minutes: 60, location: 'Studio', status: 'scheduled', archived: false,
  };
  state.readRow = { ...state.sessionRow, duration_minutes: 45 };
  const { status } = await send(`/api/sessions/${SESSION_ID}`, { duration_minutes: 45 }, 'PUT');
  assert.equal(status, 200);
  assert.equal(state.rescheduledCalls.length, 1);
});
