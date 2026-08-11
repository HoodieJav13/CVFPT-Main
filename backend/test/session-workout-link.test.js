// Session↔workout linkage: a workout started without an explicit session
// context auto-links to the client's scheduled session on the same Denver
// day (plan match first, then closest start time); explicit session context
// wins untouched; resolution failures never block a start. Supabase + auth
// stubbed via require cache.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const CLIENT_ID = 'cccccccc-0000-4000-8000-00000000000c';
const COACH_ID = 'aaaaaaaa-0000-0000-0000-00000000000a';
const LOG_ID = 'eeeeeeee-0000-0000-0000-00000000000e';
const ASSIGNMENT_ID = '11111111-1111-1111-1111-111111111111';
const WORKOUT_ID = '99999999-0000-0000-0000-000000000009';
const SESSION_NOW = 'dddddddd-0000-0000-0000-00000000000d';
const SESSION_LATER = 'dddddddd-0000-0000-0000-00000000001d';
const SESSION_EXPLICIT = 'dddddddd-0000-4000-8000-00000000002d';

// Same-Denver-day instants that never cross midnight regardless of when the
// suite runs: shift away from the nearest day boundary.
const NOW = new Date();
const denverHour = Number(new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver', hour: '2-digit', hour12: false,
}).format(NOW)) % 24;
const DIR = denverHour >= 12 ? -1 : 1;
const sameDay = (hours) => new Date(NOW.getTime() + DIR * hours * 3600 * 1000).toISOString();
const NEXT_DAY = new Date(NOW.getTime() + 26 * 3600 * 1000).toISOString();

const state = {
  rpcCalls: [],
  sessionRows: [],
  sessionQueryError: null,
  sessionQueries: 0,
  assignmentWorkoutId: null,
};

function resetState() {
  state.rpcCalls = [];
  state.sessionRows = [];
  state.sessionQueryError = null;
  state.sessionQueries = 0;
  state.assignmentWorkoutId = null;
}

const logRow = {
  id: LOG_ID, client_id: CLIENT_ID, coach_id: COACH_ID, status: 'active', archived: false,
  client: { id: CLIENT_ID, name: 'Jo', archived: false, coach_id: COACH_ID },
  exercises: [],
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
          is() { return chain; },
          or() { return chain; },
          gte() { return chain; },
          lte() { return chain; },
          order() { return chain; },
          limit() { return chain; },
          in() { return chain; },
          update() { return chain; },
          upsert() { return Promise.resolve({ data: [], error: null }); },
          maybeSingle() {
            if (table === 'workout_assignments') return Promise.resolve({ data: state.assignmentWorkoutId ? { workout_id: state.assignmentWorkoutId } : null, error: null });
            if (table === 'workout_logs') return Promise.resolve({ data: logRow, error: null });
            if (table === 'clients') return Promise.resolve({ data: { id: CLIENT_ID, coach_id: COACH_ID, archived: false }, error: null });
            return Promise.resolve({ data: null, error: null });
          },
          single() { return Promise.resolve({ data: logRow, error: null }); },
          then(resolve) {
            if (table === 'sessions') {
              state.sessionQueries += 1;
              return resolve({ data: state.sessionQueryError ? null : state.sessionRows, error: state.sessionQueryError });
            }
            if (table === 'coaches') return resolve({ data: [{ id: COACH_ID }], error: null });
            if (table === 'workout_logs') return resolve({ data: logRow, error: null });
            return resolve({ data: [], error: null });
          },
        };
        return chain;
      },
      rpc(name, args) {
        state.rpcCalls.push({ name, args });
        if (name === 'start_workout_log_v2') return Promise.resolve({ data: { outcome: 'started', workout_log_id: LOG_ID }, error: null });
        return Promise.resolve({ data: LOG_ID, error: null });
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
app.use('/api/workout-logs', require('../src/routes/workoutLogs'));
const server = http.createServer(app);
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); });

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

function startArgs() {
  return state.rpcCalls.find((call) => call.name === 'start_workout_log_v2').args;
}

const clientUser = { role: 'client', client: { id: CLIENT_ID, coach_id: COACH_ID } };

test('client start links to the same-day scheduled session', async () => {
  resetState();
  currentUser = clientUser;
  state.sessionRows = [{ id: SESSION_NOW, scheduled_at: sameDay(0), workout_id: null }];
  const { status } = await post('/api/workout-logs/start', { workout_assignment_id: ASSIGNMENT_ID });
  assert.equal(status, 201);
  assert.equal(startArgs().p_session_id, SESSION_NOW);
});

test('a session whose attached plan matches the started workout wins over a closer one', async () => {
  resetState();
  currentUser = clientUser;
  state.assignmentWorkoutId = WORKOUT_ID;
  state.sessionRows = [
    { id: SESSION_NOW, scheduled_at: sameDay(0), workout_id: null },
    { id: SESSION_LATER, scheduled_at: sameDay(4), workout_id: WORKOUT_ID },
  ];
  await post('/api/workout-logs/start', { workout_assignment_id: ASSIGNMENT_ID });
  assert.equal(startArgs().p_session_id, SESSION_LATER);
});

test('without a plan match the closest same-day session wins', async () => {
  resetState();
  currentUser = clientUser;
  state.sessionRows = [
    { id: SESSION_LATER, scheduled_at: sameDay(4), workout_id: null },
    { id: SESSION_NOW, scheduled_at: sameDay(1), workout_id: null },
  ];
  await post('/api/workout-logs/start', { workout_assignment_id: ASSIGNMENT_ID });
  assert.equal(startArgs().p_session_id, SESSION_NOW);
});

test('a session on another Denver day never links', async () => {
  resetState();
  currentUser = clientUser;
  state.sessionRows = [{ id: SESSION_LATER, scheduled_at: NEXT_DAY, workout_id: null }];
  await post('/api/workout-logs/start', { workout_assignment_id: ASSIGNMENT_ID });
  assert.equal(startArgs().p_session_id, null);
});

test('an explicit session context is used verbatim without resolution', async () => {
  resetState();
  currentUser = { role: 'coach', coach: { id: COACH_ID } };
  state.sessionRows = [{ id: SESSION_NOW, scheduled_at: sameDay(0), workout_id: null }];
  const { status, body } = await post('/api/workout-logs/start', {
    workout_assignment_id: ASSIGNMENT_ID, client_id: CLIENT_ID, session_id: SESSION_EXPLICIT,
  });
  assert.equal(status, 201, JSON.stringify(body));
  assert.equal(startArgs().p_session_id, SESSION_EXPLICIT);
  assert.equal(state.sessionQueries, 0);
});

test('a resolution failure never blocks the start', async () => {
  resetState();
  currentUser = clientUser;
  state.sessionQueryError = { message: 'boom' };
  const { status } = await post('/api/workout-logs/start', { workout_assignment_id: ASSIGNMENT_ID });
  assert.equal(status, 201);
  assert.equal(startArgs().p_session_id, null);
});

test('quick-complete links to the same-day session too', async () => {
  resetState();
  currentUser = clientUser;
  state.sessionRows = [{ id: SESSION_NOW, scheduled_at: sameDay(0), workout_id: null }];
  const { status } = await post('/api/workout-logs/quick-complete', { workout_assignment_id: ASSIGNMENT_ID });
  assert.equal(status, 201);
  assert.equal(startArgs().p_session_id, SESSION_NOW);
});
