// Program 011 A: one-tap quick-complete records a workout without set
// detail, flags quick_completed, and emits a single completed signal (no
// started twin); tracked starts notify the coach; completion reconciles
// any started notification to read. Supabase + auth stubbed via require cache.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const CLIENT_ID = 'cccccccc-0000-0000-0000-00000000000c';
const COACH_ID = 'aaaaaaaa-0000-0000-0000-00000000000a';
const LOG_ID = 'eeeeeeee-0000-0000-0000-00000000000e';

const state = {
  rpcCalls: [],
  workoutUpdates: [],
  notificationUpserts: [],
  notificationUpdates: [],
  startOutcome: 'started',
};

function resetState() {
  state.rpcCalls = [];
  state.workoutUpdates = [];
  state.notificationUpserts = [];
  state.notificationUpdates = [];
  state.startOutcome = 'started';
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
          _table: table,
          select() { return chain; },
          eq() { return chain; },
          is() { return chain; },
          or() { return chain; },
          order() { return chain; },
          limit() { return chain; },
          in() { return chain; },
          update(values) { chain._update = values; if (table === 'notifications') state.notificationUpdates.push(values); if (table === 'workout_logs') state.workoutUpdates.push(values); return chain; },
          upsert(rows) { if (table === 'notifications') state.notificationUpserts.push(rows); return Promise.resolve({ data: rows, error: null }); },
          maybeSingle() {
            if (table === 'coaches') return Promise.resolve({ data: { id: COACH_ID }, error: null });
            if (table === 'workout_logs') return Promise.resolve({ data: logRow, error: null });
            return Promise.resolve({ data: null, error: null });
          },
          single() { return Promise.resolve({ data: logRow, error: null }); },
          then(resolve) {
            if (table === 'coaches') return resolve({ data: [{ id: COACH_ID }], error: null });
            if (table === 'workout_logs') return resolve({ data: logRow, error: null });
            return resolve({ data: [], error: null });
          },
        };
        return chain;
      },
      rpc(name, args) {
        state.rpcCalls.push({ name, args });
        if (name === 'start_workout_log_v2') return Promise.resolve({ data: { outcome: state.startOutcome, workout_log_id: LOG_ID }, error: null });
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

// workoutLogWithDetails reads the log via a details query helper that uses
// supabaseAdmin; the stub returns logRow through the chain above.
const express = require('express');
const router = require('../src/routes/workoutLogs');
const app = express();
app.use(express.json());
app.use('/api/workout-logs', router);
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

test('quick-complete starts, completes-all with null values, flags quick_completed, finishes', async () => {
  resetState();
  currentUser = { role: 'client', client: { id: CLIENT_ID, coach_id: COACH_ID } };
  const { status } = await post('/api/workout-logs/quick-complete', { workout_assignment_id: '11111111-1111-1111-1111-111111111111' });
  assert.equal(status, 201);
  const rpcNames = state.rpcCalls.map((c) => c.name);
  assert.deepEqual(rpcNames, ['start_workout_log_v2', 'complete_all_workout_sets_v2', 'complete_workout_log_v2']);
  // complete-all is called with no actual-value arguments — values stay null.
  const allArgs = state.rpcCalls.find((c) => c.name === 'complete_all_workout_sets_v2').args;
  assert.deepEqual(Object.keys(allArgs).sort(), ['p_client_id', 'p_entered_by', 'p_entered_by_coach_id', 'p_workout_log_id'].sort());
  assert.ok(state.workoutUpdates.some((u) => u.quick_completed === true));
});

test('quick-complete emits a completed signal but no started twin', async () => {
  resetState();
  currentUser = { role: 'client', client: { id: CLIENT_ID, coach_id: COACH_ID } };
  await post('/api/workout-logs/quick-complete', { workout_assignment_id: '11111111-1111-1111-1111-111111111111' });
  // Started notification is never inserted on the quick path...
  const startedUpserts = state.notificationUpserts.flat().filter((n) => n.event_type === 'workout_started');
  assert.equal(startedUpserts.length, 0);
  // ...and complete_workout_log_v2 (which inserts the completed notification
  // via its own RPC body) ran exactly once.
  assert.equal(state.rpcCalls.filter((c) => c.name === 'complete_workout_log_v2').length, 1);
});

test('tracked client start notifies coaches with a started event', async () => {
  resetState();
  currentUser = { role: 'client', client: { id: CLIENT_ID, coach_id: COACH_ID } };
  const { status } = await post('/api/workout-logs/start', { workout_assignment_id: '11111111-1111-1111-1111-111111111111' });
  assert.equal(status, 201);
  const started = state.notificationUpserts.flat().filter((n) => n.event_type === 'workout_started');
  assert.ok(started.length >= 1);
  assert.equal(started[0].workout_log_id, LOG_ID);
});

test('start with suppress flag (quick path parity) sends no started notification', async () => {
  resetState();
  currentUser = { role: 'client', client: { id: CLIENT_ID, coach_id: COACH_ID } };
  await post('/api/workout-logs/start', { workout_assignment_id: '11111111-1111-1111-1111-111111111111', suppress_start_notification: true });
  assert.equal(state.notificationUpserts.flat().filter((n) => n.event_type === 'workout_started').length, 0);
});

test('completing a workout marks its started notifications read', async () => {
  resetState();
  currentUser = { role: 'client', client: { id: CLIENT_ID, coach_id: COACH_ID } };
  await post(`/api/workout-logs/${LOG_ID}/complete`, {});
  assert.ok(state.notificationUpdates.some((u) => u.read_at));
});

test('coach start does not emit a started notification (only client starts do)', async () => {
  resetState();
  currentUser = { role: 'coach', coach: { id: COACH_ID } };
  await post('/api/workout-logs/start', { workout_assignment_id: '11111111-1111-1111-1111-111111111111', client_id: CLIENT_ID });
  assert.equal(state.notificationUpserts.flat().filter((n) => n.event_type === 'workout_started').length, 0);
});

test('migration widens the notification event type and adds quick_completed', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260807170000_workout_started_and_quick_complete.sql'), 'utf8');
  assert.match(migration, /event_type in \('workout_completed', 'workout_started'\)/);
  assert.match(migration, /add column if not exists quick_completed boolean not null default false/);
});
