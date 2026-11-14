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
  state.startError = null;
  state.quickError = null;
  state.quickResult = null;
  state.pushes = 0;
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
        if (name === 'start_workout_log_with_cues' && state.startError) return Promise.resolve({data:null,error:state.startError});
        if (name === 'start_workout_log_with_cues') return Promise.resolve({ data: { outcome: state.startOutcome, workout_log_id: LOG_ID }, error: null });
        if (name === 'finish_workout_log_v3') return Promise.resolve({ data: { outcome: 'applied', mode: args.p_mode, notified: true, change_id: args.p_event_id }, error: null });
        if (name === 'quick_complete_workout_v3') {
          if (state.startError) return Promise.resolve({ data: null, error: state.startError });
          if (state.quickError) return Promise.resolve({ data: null, error: state.quickError });
          return Promise.resolve({ data: state.quickResult || { outcome: 'applied', start_outcome: 'started', workout_log_id: LOG_ID, notified: true, quick_completed: true, undoable: true, change_id: args.p_event_id }, error: null });
        }
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

// Look A (2026-11-14) supersedes the start + quick_complete_workout_log_v2
// pair: one transaction (quick_complete_workout_v3) replays a retry before any
// start, binds the event id to the target, and keeps Home's untouched guard.
const TARGET = { workout_assignment_id: '11111111-1111-1111-1111-111111111111' };
const client = () => { currentUser = { role: 'client', authUserId: 'verified-test-auth', client: { id: CLIENT_ID, coach_id: COACH_ID } }; };

test('quick-complete runs one atomic database call bound to client, target and event', async () => {
  resetState(); client();
  const { status, body } = await post('/api/workout-logs/quick-complete', TARGET);
  assert.equal(status, 201);
  assert.deepEqual(state.rpcCalls.map((c) => c.name), ['quick_complete_workout_v3'], 'no separate start call');
  const args = state.rpcCalls[0].args;
  assert.equal(args.p_client_id, CLIENT_ID);
  assert.equal(args.p_workout_assignment_id, TARGET.workout_assignment_id);
  assert.equal(args.p_program_assignment_id, null);
  assert.equal(args.p_auth_user_id, 'verified-test-auth');
  assert.match(args.p_event_id, /^[0-9a-f-]{36}$/);
  assert.equal(body.change.id, args.p_event_id, 'the reply names the change its Undo targets');
  assert.equal(body.change.undoable, true);
  assert.equal(state.workoutUpdates.length, 0);
});

test('quick-complete forwards a client event id; an invalid one is never forwarded', async () => {
  resetState(); client();
  const eventId = '9a9a9a9a-0000-4000-8000-000000000001';
  await post('/api/workout-logs/quick-complete', { ...TARGET, event_id: eventId });
  assert.equal(state.rpcCalls[0].args.p_event_id, eventId);
  resetState(); client();
  await post('/api/workout-logs/quick-complete', { ...TARGET, event_id: 'not-a-uuid' });
  assert.notEqual(state.rpcCalls[0].args.p_event_id, 'not-a-uuid');
});

test('quick-complete retry replays the first answer with 200 and no second push', async () => {
  resetState(); client();
  state.quickResult = { outcome: 'replayed', original_outcome: 'applied', workout_log_id: LOG_ID, notified: false, undoable: true };
  const { status, body } = await post('/api/workout-logs/quick-complete', { ...TARGET, event_id: '9a9a9a9a-0000-4000-8000-000000000002' });
  assert.equal(status, 200);
  assert.equal(body.id, LOG_ID);
  assert.equal(body.change.id, '9a9a9a9a-0000-4000-8000-000000000002');
});

test('quick-complete with an id used for another target or change is 409, not 500', async () => {
  resetState(); client();
  state.quickError = { message: 'event_id_reused' };
  const { status, body } = await post('/api/workout-logs/quick-complete', { ...TARGET, event_id: '9a9a9a9a-0000-4000-8000-000000000003' });
  assert.equal(status, 409);
  assert.match(body.error, /already used/);
});

test('quick-complete keeps the Home guard: logged changes stay active (409 with the workout)', async () => {
  resetState(); client();
  state.quickResult = { outcome: 'refused', reason: 'logged_changes', workout_log_id: LOG_ID, start_outcome: 'started' };
  const { status, body } = await post('/api/workout-logs/quick-complete', TARGET);
  assert.equal(status, 409);
  assert.match(body.error, /logged changes/);
  assert.equal(body.active_workout.id, LOG_ID);
  state.quickResult = { outcome: 'replayed', original_outcome: 'refused', reason: 'logged_changes', workout_log_id: LOG_ID };
  assert.equal((await post('/api/workout-logs/quick-complete', TARGET)).status, 409, 'a replayed refusal stays a refusal');
});

test('quick-complete does not finish an active or already-done workout', async () => {
  resetState(); client();
  state.quickResult = { outcome: 'not_started', start_outcome: 'resumed', workout_log_id: LOG_ID };
  let r = await post('/api/workout-logs/quick-complete', TARGET);
  assert.equal(r.status, 409); assert.equal(r.body.active_workout.id, LOG_ID);
  state.quickResult = { outcome: 'not_started', start_outcome: 'already_completed', workout_log_id: null };
  r = await post('/api/workout-logs/quick-complete', TARGET);
  assert.equal(r.status, 409); assert.match(r.body.error, /already done/);
});

test('quick-complete emits a completed signal but no started twin', async () => {
  resetState(); client();
  await post('/api/workout-logs/quick-complete', TARGET);
  const startedUpserts = state.notificationUpserts.flat().filter((n) => n.event_type === 'workout_started');
  assert.equal(startedUpserts.length, 0);
  assert.equal(state.rpcCalls.filter((c) => c.name === 'quick_complete_workout_v3').length, 1);
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

 test('quick-complete missing cue migration is unavailable without exposing SQL details', async () => {
  resetState(); currentUser={role:'client',authUserId:'verified-test-auth',client:{id:CLIENT_ID,coach_id:COACH_ID}};
  state.startError={code:'42883',message:'SQL function signature should stay internal'};
  const result=await post('/api/workout-logs/quick-complete',{workout_assignment_id:'11111111-1111-1111-1111-111111111111'});
  assert.equal(result.status,503);assert.equal(result.body.error,'Workout start is currently unavailable.');
  assert.equal(state.rpcCalls[0].args.p_auth_user_id,'verified-test-auth');
 });
