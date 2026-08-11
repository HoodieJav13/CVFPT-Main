// Coach session surface: the list carries the attached plan and the linked
// workout log for scheduled sessions (active beats completed), the coach
// detail endpoint returns plan/notes/linked logs with ownership masking,
// completing a future day's session is refused, and the client surfaces
// carry a persistent cancel_requested flag. Supabase + auth stubbed.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const COACH_ID = 'aaaaaaaa-0000-4000-8000-00000000000a';
const OTHER_COACH_ID = 'bbbbbbbb-0000-4000-8000-00000000000b';
const CLIENT_ID = 'cccccccc-0000-4000-8000-00000000000c';
const SESSION_ID = 'eeeeeeee-0000-4000-8000-00000000000e';
const SESSION_B_ID = 'eeeeeeee-0000-4000-8000-00000000001e';
const LOG_ACTIVE = '11111111-0000-4000-8000-000000000011';
const LOG_DONE = '22222222-0000-4000-8000-000000000022';
const FUTURE = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
const NOW = new Date().toISOString();

const state = {
  sessionRows: [],
  sessionRow: null,
  logRows: [],
  noteRows: [],
  cancelRequestRows: [],
  rpcCalls: [],
  logQueries: 0,
};

function resetState() {
  state.sessionRows = [];
  state.sessionRow = null;
  state.logRows = [];
  state.noteRows = [];
  state.cancelRequestRows = [];
  state.rpcCalls = [];
  state.logQueries = 0;
}

const supabasePath = require.resolve('../src/supabase');
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: {
    supabaseAdmin: {
      from(table) {
        const chain = {
          _eqs: {},
          select() { return chain; },
          eq(col, value) { chain._eqs[col] = value; return chain; },
          in() { return chain; },
          is() { return chain; },
          or() { return chain; },
          gte() { return chain; },
          lte() { return chain; },
          lt() { return chain; },
          order() { return chain; },
          limit() { return chain; },
          update(values) { chain._update = values; return chain; },
          maybeSingle() {
            if (table === 'sessions') return Promise.resolve({ data: state.sessionRow, error: null });
            return Promise.resolve({ data: null, error: null });
          },
          single() {
            if (table === 'sessions') return Promise.resolve({ data: { ...state.sessionRow, ...(chain._update || {}) }, error: null });
            return Promise.resolve({ data: null, error: null });
          },
          then(resolve) {
            if (table === 'sessions') return resolve({ data: state.sessionRows, error: null });
            if (table === 'workout_logs') { state.logQueries += 1; return resolve({ data: state.logRows, error: null }); }
            if (table === 'session_notes') return resolve({ data: state.noteRows, error: null });
            if (table === 'notifications') return resolve({ data: state.cancelRequestRows, error: null });
            return resolve({ data: [], error: null });
          },
        };
        return chain;
      },
      rpc(name, args) {
        state.rpcCalls.push({ name, args });
        if (name === 'complete_session') {
          return Promise.resolve({ data: { session: { ...state.sessionRow, status: 'completed' } }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
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

async function send(pathname, { method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method, headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const coachUser = { role: 'coach', coach: { id: COACH_ID, name: 'Coach Sam' } };
const clientUser = { role: 'client', client: { id: CLIENT_ID, coach_id: COACH_ID } };

function session(overrides = {}) {
  return {
    id: SESSION_ID, client_id: CLIENT_ID, coach_id: COACH_ID, scheduled_at: NOW,
    duration_minutes: 60, location: 'CVF Studio', status: 'scheduled', archived: false,
    workout_id: null, client: { id: CLIENT_ID, name: 'Jo' },
    coach: { id: COACH_ID, name: 'Coach Sam' }, workout: null,
    ...overrides,
  };
}

test('list surfaces the linked workout log; an active log beats a completed one', async () => {
  resetState();
  currentUser = coachUser;
  state.sessionRows = [session(), session({ id: SESSION_B_ID })];
  state.logRows = [
    { id: LOG_DONE, session_id: SESSION_ID, status: 'completed', started_at: NOW, completed_at: NOW, quick_completed: false },
    { id: LOG_ACTIVE, session_id: SESSION_ID, status: 'active', started_at: NOW, completed_at: null, quick_completed: false },
  ];
  const { status, body } = await send('/api/sessions');
  assert.equal(status, 200);
  assert.equal(body[0].linked_workout_log.id, LOG_ACTIVE);
  assert.equal(body[1].linked_workout_log, null);
});

test('list skips the log lookup entirely when nothing is scheduled', async () => {
  resetState();
  currentUser = coachUser;
  state.sessionRows = [session({ status: 'completed' })];
  const { status, body } = await send('/api/sessions');
  assert.equal(status, 200);
  assert.equal(state.logQueries, 0);
  assert.equal(body[0].linked_workout_log, null);
});

test('coach detail returns all notes, the plan, and linked logs', async () => {
  resetState();
  currentUser = coachUser;
  state.sessionRow = session({ workout_id: '99999999-0000-4000-8000-000000000099', workout: { id: '9', name: 'Lower A', description: null, goal: null } });
  state.noteRows = [
    { id: 'n1', content: 'Private', shared_with_client: false },
    { id: 'n2', content: 'Shared', shared_with_client: true },
  ];
  state.logRows = [{ id: LOG_DONE, status: 'completed', workout_name: 'Lower A', started_at: NOW, completed_at: NOW, quick_completed: false }];
  const { status, body } = await send(`/api/sessions/${SESSION_ID}/coach-detail`);
  assert.equal(status, 200);
  assert.equal(body.notes.length, 2);
  assert.equal(body.linked_workout_logs[0].id, LOG_DONE);
  assert.equal(body.workout.name, 'Lower A');
});

test('coach detail masks another coach\'s session for non-admins', async () => {
  resetState();
  currentUser = coachUser;
  state.sessionRow = session({ coach_id: OTHER_COACH_ID });
  const { status } = await send(`/api/sessions/${SESSION_ID}/coach-detail`);
  assert.equal(status, 404);
});

test('completing a future day\'s session is refused; today\'s completes', async () => {
  resetState();
  currentUser = coachUser;
  state.sessionRow = session({ scheduled_at: FUTURE });
  let result = await send(`/api/sessions/${SESSION_ID}/complete`, { method: 'PATCH' });
  assert.equal(result.status, 400);
  assert.equal(state.rpcCalls.length, 0);

  state.sessionRow = session();
  result = await send(`/api/sessions/${SESSION_ID}/complete`, { method: 'PATCH' });
  assert.equal(result.status, 200);
  assert.equal(state.rpcCalls[0].name, 'complete_session');
});

test('client sessions carry a persistent cancel_requested flag', async () => {
  resetState();
  currentUser = clientUser;
  state.sessionRows = [session(), session({ id: SESSION_B_ID })];
  state.cancelRequestRows = [{ session_id: SESSION_B_ID }];
  const { status, body } = await send('/api/sessions/client/mine');
  assert.equal(status, 200);
  assert.equal(body.find((s) => s.id === SESSION_B_ID).cancel_requested, true);
  assert.equal(body.find((s) => s.id === SESSION_ID).cancel_requested, false);
});

test('client detail carries the cancel_requested flag too', async () => {
  resetState();
  currentUser = clientUser;
  state.sessionRow = session();
  state.cancelRequestRows = [{ session_id: SESSION_ID }];
  const { status, body } = await send(`/api/sessions/${SESSION_ID}/client-detail`);
  assert.equal(status, 200);
  assert.equal(body.cancel_requested, true);
});
