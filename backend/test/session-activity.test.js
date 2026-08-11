// Program 013: coach-side workout activity on session rows + the coach
// session detail surface. Supabase/auth/email/push stubbed via require cache.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const COACH_ID = 'aaaaaaaa-0000-0000-0000-00000000000a';
const CLIENT_ID = 'cccccccc-0000-0000-0000-00000000000c';
const OTHER_CLIENT_ID = 'cdcdcdcd-0000-0000-0000-00000000000d';
const SESSION_ID = 'eeeeeeee-0000-0000-0000-00000000000e';

const todayAt = (hour) => {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

const state = { sessions: [], logs: [], sessionRow: null, notes: [] };

function resetState() {
  state.sessions = [];
  state.logs = [];
  state.sessionRow = null;
  state.notes = [];
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
          in() { return chain; },
          gte() { return chain; },
          lte() { return chain; },
          lt() { return chain; },
          order() { return chain; },
          maybeSingle() { return Promise.resolve({ data: table === 'sessions' ? state.sessionRow : null, error: null }); },
          single() { return Promise.resolve({ data: state.sessionRow, error: null }); },
          then(resolve) {
            if (table === 'sessions') return resolve({ data: state.sessions, error: null });
            if (table === 'workout_logs') return resolve({ data: state.logs, error: null });
            if (table === 'session_notes') return resolve({ data: state.notes, error: null });
            return resolve({ data: [], error: null });
          },
        };
        return chain;
      },
      rpc() { return Promise.resolve({ data: null, error: null }); },
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
    formatDenver: (v) => String(v),
    notifySessionCancelRequested: () => Promise.resolve({}),
    notifySessionCancelled: () => Promise.resolve({}),
    notifySessionCancelledByClient: () => Promise.resolve({}),
    notifySessionRescheduled: () => Promise.resolve({}),
    notifySessionScheduled: () => Promise.resolve({}),
  },
};

const pushPath = require.resolve('../src/services/push');
require.cache[pushPath] = {
  id: pushPath, filename: pushPath, loaded: true,
  exports: { dispatchPush: () => ({ skipped: 'test' }), sendToClient: () => Promise.resolve({}), sendToCoaches: () => Promise.resolve({}) },
};

const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/sessions', require('../src/routes/sessions'));
const server = http.createServer(app);
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); });

async function get(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  return { status: response.status, body: await response.json() };
}

const coachUser = { role: 'coach', coach: { id: COACH_ID } };

test('an in-progress workout that day shows as active activity', async () => {
  resetState();
  currentUser = coachUser;
  state.sessions = [{ id: SESSION_ID, client_id: CLIENT_ID, coach_id: COACH_ID, scheduled_at: todayAt(15), archived: false }];
  state.logs = [{ id: 'log-1', client_id: CLIENT_ID, session_id: null, workout_name: 'Lower A', status: 'active', quick_completed: false, started_at: todayAt(14) }];
  const { status, body } = await get('/api/sessions');
  assert.equal(status, 200);
  assert.equal(body[0].workout_activity.status, 'active');
  assert.equal(body[0].workout_activity.workout_name, 'Lower A');
  assert.equal(body[0].workout_activity.linked, false);
});

test('an explicitly linked log wins over another same-day log', async () => {
  resetState();
  currentUser = coachUser;
  state.sessions = [{ id: SESSION_ID, client_id: CLIENT_ID, coach_id: COACH_ID, scheduled_at: todayAt(15), archived: false }];
  state.logs = [
    { id: 'log-active', client_id: CLIENT_ID, session_id: null, workout_name: 'Other', status: 'active', quick_completed: false, started_at: todayAt(9) },
    { id: 'log-linked', client_id: CLIENT_ID, session_id: SESSION_ID, workout_name: 'Session plan', status: 'completed', quick_completed: true, started_at: todayAt(15) },
  ];
  const { body } = await get('/api/sessions');
  assert.equal(body[0].workout_activity.workout_log_id, 'log-linked');
  assert.equal(body[0].workout_activity.linked, true);
  assert.equal(body[0].workout_activity.quick_completed, true);
});

test('another client\'s workout never leaks onto a session', async () => {
  resetState();
  currentUser = coachUser;
  state.sessions = [{ id: SESSION_ID, client_id: CLIENT_ID, coach_id: COACH_ID, scheduled_at: todayAt(15), archived: false }];
  state.logs = [{ id: 'log-other', client_id: OTHER_CLIENT_ID, session_id: null, workout_name: 'Not theirs', status: 'active', quick_completed: false, started_at: todayAt(14) }];
  const { body } = await get('/api/sessions');
  assert.equal(body[0].workout_activity, null);
});

test('a workout on a different day is not shown on this session', async () => {
  resetState();
  currentUser = coachUser;
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
  yesterday.setHours(10, 0, 0, 0);
  state.sessions = [{ id: SESSION_ID, client_id: CLIENT_ID, coach_id: COACH_ID, scheduled_at: todayAt(15), archived: false }];
  state.logs = [{ id: 'log-old', client_id: CLIENT_ID, session_id: null, workout_name: 'Yesterday', status: 'completed', quick_completed: false, started_at: yesterday.toISOString() }];
  const { body } = await get('/api/sessions');
  assert.equal(body[0].workout_activity, null);
});

test('coach detail returns the plan, all notes, and the activity', async () => {
  resetState();
  currentUser = coachUser;
  state.sessionRow = {
    id: SESSION_ID, client_id: CLIENT_ID, coach_id: COACH_ID, scheduled_at: todayAt(15),
    duration_minutes: 60, status: 'scheduled', archived: false, workout_id: null,
    client: { id: CLIENT_ID, name: 'Jo' }, workout: null,
  };
  state.notes = [
    { id: 'n1', content: 'Private note', shared_with_client: false },
    { id: 'n2', content: 'Shared note', shared_with_client: true },
  ];
  state.logs = [{ id: 'log-1', client_id: CLIENT_ID, session_id: null, workout_name: 'Lower A', status: 'completed', quick_completed: false, started_at: todayAt(14) }];
  const { status, body } = await get(`/api/sessions/${SESSION_ID}/coach-detail`);
  assert.equal(status, 200);
  // Coaches see every note, unlike the client surface which filters to shared.
  assert.equal(body.notes.length, 2);
  assert.equal(body.workout_activity.status, 'completed');
});

test('coach detail masks a session belonging to another coach', async () => {
  resetState();
  currentUser = coachUser;
  state.sessionRow = { id: SESSION_ID, client_id: CLIENT_ID, coach_id: 'bbbbbbbb-0000-0000-0000-00000000000b', archived: false };
  const { status } = await get(`/api/sessions/${SESSION_ID}/coach-detail`);
  assert.equal(status, 404);
});

test('no-shows are listed in the coach Past filter, not lost', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/coach/Sessions.jsx'), 'utf8');
  assert.match(source, /\['completed', 'no_show'\]\.includes\(s\.status\)/);
  // Rows link to the detail page rather than only exposing the 3-dot menu.
  assert.match(source, /to=\{`\/coach\/sessions\/\$\{s\.id\}`\}/);
});
