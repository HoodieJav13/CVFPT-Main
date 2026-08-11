// Program 011 B: session↔workout attachment rules and the client session
// detail surface (shared notes only, own sessions only, attached plan).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const COACH_ID = 'aaaaaaaa-0000-0000-0000-00000000000a';
const CLIENT_ID = 'cccccccc-0000-0000-0000-00000000000c';
const SESSION_ID = 'eeeeeeee-0000-0000-0000-00000000000e';
const WORKOUT_ID = '99999999-0000-0000-0000-000000000009';
const FUTURE = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

const state = {
  workoutRow: null,
  sessionRow: null,
  clientRow: null,
  sessionUpdates: [],
  noteFilters: [],
  rescheduled: 0,
};

function resetState() {
  state.workoutRow = { id: WORKOUT_ID, coach_id: COACH_ID };
  state.sessionRow = null;
  state.clientRow = { id: CLIENT_ID, coach_id: COACH_ID, archived: false };
  state.sessionUpdates = [];
  state.noteFilters = [];
  state.rescheduled = 0;
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
          order() { return chain; },
          update(values) { chain._update = values; if (table === 'sessions') state.sessionUpdates.push(values); return chain; },
          maybeSingle() {
            if (table === 'workouts') return Promise.resolve({ data: state.workoutRow, error: null });
            if (table === 'sessions') return Promise.resolve({ data: state.sessionRow, error: null });
            if (table === 'clients') return Promise.resolve({ data: state.clientRow, error: null });
            return Promise.resolve({ data: null, error: null });
          },
          single() {
            if (table === 'sessions') return Promise.resolve({ data: { ...state.sessionRow, ...(chain._update || {}) }, error: null });
            return Promise.resolve({ data: null, error: null });
          },
          then(resolve) {
            if (table === 'session_notes') {
              state.noteFilters.push(chain._eqs);
              return resolve({ data: [{ id: 'note-1', content: 'Shared note', shared_with_client: true }], error: null });
            }
            if (table === 'workout_exercises') {
              return resolve({
                data: [{ id: 'wex-1', custom_name: 'Goblet Squat', sets: '3', reps: '8-10', rest: '90s', client_notes: null, position: 0, library_exercise: null }],
                error: null,
              });
            }
            return resolve({ data: [], error: null });
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
    notifySessionScheduled: () => Promise.resolve({}),
    notifySessionRescheduled: () => { state.rescheduled += 1; return Promise.resolve({}); },
    notifySessionCancelled: () => Promise.resolve({}),
    notifySessionCancelledByClient: () => Promise.resolve({}),
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

async function send(pathname, { method = 'POST', body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method, headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const coachUser = { role: 'coach', coach: { id: COACH_ID, name: 'Coach Sam' } };
const clientUser = { role: 'client', client: { id: CLIENT_ID, coach_id: COACH_ID } };

function scheduledSession(overrides = {}) {
  return {
    id: SESSION_ID, client_id: CLIENT_ID, coach_id: COACH_ID, scheduled_at: FUTURE,
    duration_minutes: 60, location: 'CVF Studio', status: 'scheduled', archived: false,
    workout_id: null, coach: { id: COACH_ID, name: 'Coach Sam' }, workout: null,
    ...overrides,
  };
}

test('create attaches an owned workout; another coach\'s workout is refused', async () => {
  resetState();
  currentUser = coachUser;
  state.sessionRow = scheduledSession();
  let result = await send('/api/sessions', { body: { client_id: CLIENT_ID, scheduled_at: FUTURE, duration_minutes: 60, workout_id: WORKOUT_ID } });
  assert.equal(result.status, 201);
  assert.ok(state.sessionUpdates.some((u) => u.workout_id === WORKOUT_ID));

  resetState();
  currentUser = coachUser;
  state.workoutRow = { id: WORKOUT_ID, coach_id: 'bbbbbbbb-0000-0000-0000-00000000000b' };
  result = await send('/api/sessions', { body: { client_id: CLIENT_ID, scheduled_at: FUTURE, duration_minutes: 60, workout_id: WORKOUT_ID } });
  assert.equal(result.status, 400);
  assert.equal(state.sessionUpdates.length, 0);
});

test('update can detach with workout_id null, and attach alone sends no reschedule email', async () => {
  resetState();
  currentUser = coachUser;
  state.sessionRow = scheduledSession({ workout_id: WORKOUT_ID });
  const result = await send(`/api/sessions/${SESSION_ID}`, { method: 'PUT', body: { duration_minutes: 60, workout_id: null } });
  assert.equal(result.status, 200);
  assert.ok(state.sessionUpdates.some((u) => u.workout_id === null));
  assert.equal(state.rescheduled, 0);
});

test('client detail returns own session with shared-only notes and the attached plan', async () => {
  resetState();
  currentUser = clientUser;
  state.sessionRow = scheduledSession({ workout_id: WORKOUT_ID, workout: { id: WORKOUT_ID, name: 'Lower A', description: null, goal: null } });
  const result = await send(`/api/sessions/${SESSION_ID}/client-detail`, { method: 'GET' });
  assert.equal(result.status, 200);
  assert.equal(result.body.workout.name, 'Lower A');
  assert.equal(result.body.workout.exercises[0].name, 'Goblet Squat');
  assert.equal(result.body.shared_notes.length, 1);
  // The notes query filtered to shared_with_client=true — never all notes.
  assert.ok(state.noteFilters.every((filters) => filters.shared_with_client === true));
});

test('client detail masks sessions that are not yours', async () => {
  resetState();
  currentUser = clientUser;
  state.sessionRow = null; // query is scoped to the caller's client_id
  const result = await send(`/api/sessions/${SESSION_ID}/client-detail`, { method: 'GET' });
  assert.equal(result.status, 404);
});

test('migration adds the nullable workout reference forward-only', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260810200000_session_workout_attachment.sql'), 'utf8');
  assert.match(migration, /add column if not exists workout_id uuid references public\.workouts\(id\)/);
  // Nullable (no SET NOT NULL), forward-only (no drops/deletes); the
  // partial index's "is not null" predicate is expected.
  assert.doesNotMatch(migration, /set not null|drop table|drop column|delete from/i);
});
