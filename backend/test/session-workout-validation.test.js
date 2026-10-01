// Workout attachment validation: must happen BEFORE scheduling mutates anything,
// and shared (coach_id null) unarchived workouts are valid for any coach.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const COACH_ID = 'aaaaaaaa-0000-0000-0000-00000000000a';
const OTHER_COACH_ID = 'bbbbbbbb-0000-0000-0000-00000000000b';
const CLIENT_ID = 'cccccccc-0000-0000-0000-00000000000c';
const SESSION_ID = 'eeeeeeee-0000-0000-0000-00000000000e';
const WORKOUT_ID = '99999999-0000-0000-0000-000000000009';
const WORKOUT_ID_2 = '99999999-0000-0000-0000-00000000000a';
const FUTURE = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

const state = {};
function resetState() {
  state.workoutRow = { id: WORKOUT_ID, coach_id: COACH_ID };
  state.workoutList = [];
  state.sessionRow = null;
  state.clientRow = { id: CLIENT_ID, coach_id: COACH_ID, archived: false };
  state.sessionUpdates = [];
  state.rpcCalls = [];
  state.workoutQueries = 0;
}

const supabasePath = require.resolve('../src/supabase');
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: {
    supabaseAdmin: {
      from(table) {
        if (table === 'workouts') state.workoutQueries += 1;
        const chain = {
          _update: null,
          select() { return chain; },
          eq() { return chain; },
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
            if (table === 'workouts') return resolve({ data: state.workoutList, error: null });
            return resolve({ data: [], error: null });
          },
        };
        return chain;
      },
      rpc(name, args) {
        state.rpcCalls.push({ name, args });
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
    notifySessionRescheduled: () => Promise.resolve({}),
    notifySessionCancelled: () => Promise.resolve({}),
    notifySessionCancelledByClient: () => Promise.resolve({}),
    formatDenver: () => 'formatted',
  },
};

const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/sessions', require('../src/routes/sessions'));
const { validateWorkoutAttachment, validateWorkoutIds } = require('../src/lib/sessionWorkouts');
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
const scheduledCalls = () => state.rpcCalls.filter((call) => call.name === 'schedule_session');
const createBody = (workout_id) => ({ client_id: CLIENT_ID, scheduled_at: FUTURE, duration_minutes: 60, workout_id });

test('create accepts a shared (coach_id null) unarchived workout', async () => {
  resetState();
  currentUser = coachUser;
  state.workoutRow = { id: WORKOUT_ID, coach_id: null };
  state.sessionRow = { id: SESSION_ID, client_id: CLIENT_ID, coach_id: COACH_ID, scheduled_at: FUTURE, duration_minutes: 60, status: 'scheduled' };
  const result = await send('/api/sessions', { body: createBody(WORKOUT_ID) });
  assert.equal(result.status, 201);
  assert.equal(scheduledCalls().length, 1);
  assert.ok(state.sessionUpdates.some((update) => update.workout_id === WORKOUT_ID));
});

test('update can still detach a workout with null', async () => {
  resetState();
  currentUser = coachUser;
  state.sessionRow = { id: SESSION_ID, client_id: CLIENT_ID, coach_id: COACH_ID, scheduled_at: FUTURE, duration_minutes: 60, status: 'scheduled', archived: false, workout_id: WORKOUT_ID };
  const result = await send(`/api/sessions/${SESSION_ID}`, { method: 'PUT', body: { duration_minutes: 60, workout_id: null } });
  assert.equal(result.status, 200);
  assert.ok(state.sessionUpdates.some((update) => update.workout_id === null));
});

test('validateWorkoutIds validates many ids with exactly one workouts query', async () => {
  resetState();
  state.workoutList = [
    { id: WORKOUT_ID, coach_id: COACH_ID },
    { id: WORKOUT_ID_2, coach_id: null },
  ];
  const result = await validateWorkoutIds([WORKOUT_ID, WORKOUT_ID_2, WORKOUT_ID, null, undefined], COACH_ID);
  assert.deepEqual(result, { ok: true, value: [WORKOUT_ID, WORKOUT_ID_2] });
  assert.equal(state.workoutQueries, 1);
});

test('validateWorkoutIds rejects an unusable id and skips the query when there is nothing to check', async () => {
  resetState();
  state.workoutList = [{ id: WORKOUT_ID, coach_id: OTHER_COACH_ID }];
  assert.deepEqual(await validateWorkoutIds([WORKOUT_ID], COACH_ID), { ok: false, error: 'Workout not found' });
  resetState();
  assert.deepEqual(await validateWorkoutIds([null, undefined], COACH_ID), { ok: true, value: [] });
  assert.equal(state.workoutQueries, 0);
  assert.equal((await validateWorkoutIds(['nope'], COACH_ID)).ok, false);
});

test('validateWorkoutAttachment null detaches without a query', async () => {
  resetState();
  assert.deepEqual(await validateWorkoutAttachment(null, COACH_ID), { ok: true, value: null });
  assert.equal(state.workoutQueries, 0);
});

test('create with another coach\'s workout returns 400 and never calls schedule_session', async () => {
  resetState();
  currentUser = coachUser;
  state.workoutRow = { id: WORKOUT_ID, coach_id: OTHER_COACH_ID };
  const result = await send('/api/sessions', { body: createBody(WORKOUT_ID) });
  assert.equal(result.status, 400);
  assert.equal(scheduledCalls().length, 0);
});

test('create with an archived or missing workout returns 400 and never schedules', async () => {
  resetState();
  currentUser = coachUser;
  state.workoutRow = null; // the query filters archived = false
  const result = await send('/api/sessions', { body: createBody(WORKOUT_ID) });
  assert.equal(result.status, 400);
  assert.equal(scheduledCalls().length, 0);
});

test('create with a malformed workout id returns 400 and never schedules', async () => {
  resetState();
  currentUser = coachUser;
  const result = await send('/api/sessions', { body: createBody('not-a-uuid') });
  assert.equal(result.status, 400);
  assert.equal(scheduledCalls().length, 0);
});

test('update with a foreign workout returns 400 and never reschedules', async () => {
  resetState();
  currentUser = coachUser;
  state.workoutRow = { id: WORKOUT_ID, coach_id: OTHER_COACH_ID };
  state.sessionRow = { id: SESSION_ID, client_id: CLIENT_ID, coach_id: COACH_ID, scheduled_at: FUTURE, duration_minutes: 60, status: 'scheduled', archived: false };
  const result = await send(`/api/sessions/${SESSION_ID}`, { method: 'PUT', body: { duration_minutes: 45, workout_id: WORKOUT_ID } });
  assert.equal(result.status, 400);
  assert.equal(scheduledCalls().length, 0);
});
