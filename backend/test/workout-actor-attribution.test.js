const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const {
  canWriteLog,
  actorStamp,
  workoutSetUpdatePayload,
} = require('../src/routes/workoutLogs');

const root = path.join(__dirname, '..', '..');
const workoutRoutes = fs.readFileSync(path.join(root, 'backend', 'src', 'routes', 'workoutLogs.js'), 'utf8');
const attributionMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260730202255_workout_set_attribution_and_session_link.sql'),
  'utf8',
);
const rpcMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260730203738_workout_actor_rpcs_v2.sql'),
  'utf8',
);

const coachA = { role: 'coach', coach: { id: 'coach-a' } };
const coachB = { role: 'coach', coach: { id: 'coach-b' } };
const admin = { role: 'admin', coach: { id: 'admin-1' } };
const clientUserA = { role: 'client', client: { id: 'client-a' } };
const clientUserB = { role: 'client', client: { id: 'client-b' } };

const logOfClientA = {
  id: 'log-1',
  client_id: 'client-a',
  archived: false,
  client: { id: 'client-a', coach_id: 'coach-a', archived: false },
};

// Owner-blessed authorization matrix (docs/roadmap.md, ballot item 3).
test('matrix row 1: coach on own client is allowed to write', () => {
  assert.equal(canWriteLog(coachA, logOfClientA), true);
});

test('matrix row 2: coach on another coach\'s client is masked', () => {
  assert.equal(canWriteLog(coachB, logOfClientA), false);
});

test('matrix row 3: client on own log is allowed to write', () => {
  assert.equal(canWriteLog(clientUserA, logOfClientA), true);
});

test('matrix row 4: client on another client\'s log is masked', () => {
  assert.equal(canWriteLog(clientUserB, logOfClientA), false);
});

test('matrix row 5: a client cannot forge coach attribution via the body', () => {
  // The stamp derives from the authenticated actor only.
  assert.deepEqual(actorStamp(clientUserA), { entered_by: 'client', entered_by_coach_id: null });
  // The set-update payload builder never reads attribution from the body.
  const payload = workoutSetUpdatePayload(
    { status: 'completed', entered_by: 'coach', entered_by_coach_id: 'coach-a' },
    { status: 'pending', actual_load_value: 100, actual_load_unit: 'lb', actual_reps: null, actual_rpe: null },
  );
  assert.equal(Object.hasOwn(payload, 'entered_by'), false);
  assert.equal(Object.hasOwn(payload, 'entered_by_coach_id'), false);
  // Route source stamps exclusively via actorStamp(req.user).
  assert.doesNotMatch(workoutRoutes, /body\.entered_by|req\.body\?\.entered_by/);
  assert.match(workoutRoutes, /\.\.\.actorStamp\(req\.user\)/);
});

test('admin writes carry coach attribution with their own snapshot', () => {
  assert.equal(canWriteLog(admin, logOfClientA), true);
  assert.deepEqual(actorStamp(admin), { entered_by: 'coach', entered_by_coach_id: 'admin-1' });
});

test('coaches cannot write for archived clients or archived logs', () => {
  assert.equal(canWriteLog(coachA, {
    ...logOfClientA, client: { ...logOfClientA.client, archived: true },
  }), false);
  assert.equal(canWriteLog(coachA, { ...logOfClientA, archived: true }), false);
  assert.equal(canWriteLog(coachA, null), false);
});

test('mutating routes flow through the writable-log guard and v2 completion RPC', () => {
  assert.match(workoutRoutes, /async function requireWritableActiveLog/);
  for (const route of [
    "router.patch('/:id/sets/:setId', async",
    "router.post('/:id/exercises/:exerciseId/sets', async",
    "router.patch('/:id/sets/:setId/archive', async",
    "router.patch('/:id/exercises/:exerciseId/notes', async",
    "router.post('/:id/complete-all', async",
    "router.post('/:id/abandon', async",
    "router.post('/:id/complete', async",
  ]) {
    assert.ok(workoutRoutes.includes(route), `expected actor-aware route: ${route}`);
  }
  assert.match(workoutRoutes, /rpc\('complete_all_workout_sets_v2'/);
  // Completion passes the log's own client, not the caller's identity.
  assert.match(workoutRoutes, /p_client_id: log\.client_id/);
});

test('attribution schema enforces pair consistency and defaults to client', () => {
  assert.match(attributionMigration, /entered_by text not null default 'client'/);
  assert.match(attributionMigration, /\(entered_by = 'coach'\) = \(entered_by_coach_id is not null\)/);
  assert.match(attributionMigration, /started_by text not null default 'client'/);
  assert.match(attributionMigration, /\(started_by = 'coach'\) = \(started_by_coach_id is not null\)/);
  assert.match(attributionMigration, /session_id uuid references public\.sessions\(id\)/);
});

test('v2 RPCs are invoker-security and service-role-only', () => {
  for (const [name, signature] of [
    ['start_workout_log_v2', 'uuid, uuid, uuid, uuid, text, uuid, uuid'],
    ['complete_all_workout_sets_v2', 'uuid, uuid, text, uuid'],
  ]) {
    assert.match(rpcMigration, new RegExp(`create or replace function public\\.${name}[\\s\\S]*?security invoker[\\s\\S]*?set search_path = ''`));
    assert.match(rpcMigration, new RegExp(`revoke execute on function public\\.${name}\\(${signature}\\) from public, anon, authenticated;`));
    assert.match(rpcMigration, new RegExp(`grant execute on function public\\.${name}\\(${signature}\\) to service_role;`));
  }
  assert.match(rpcMigration, /Session not found for this client/);
});

const completionV2Migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260731060050_complete_workout_log_v2.sql'),
  'utf8',
);
const routesSource = fs.readFileSync(path.join(root, 'backend', 'src', 'routes', 'workoutLogs.js'), 'utf8');

test('performance-time completion is clamped and service-role-only', () => {
  assert.match(completionV2Migration, /p_completed_at is null or p_completed_at <= v_log\.started_at or p_completed_at > now\(\)/);
  assert.match(completionV2Migration, /create or replace function public\.complete_workout_log_v2[\s\S]*?security invoker[\s\S]*?set search_path = ''/);
  assert.match(completionV2Migration, /revoke execute on function public\.complete_workout_log_v2\(uuid, uuid, text, text, timestamptz\) from public, anon, authenticated;/);
  assert.match(completionV2Migration, /grant execute on function public\.complete_workout_log_v2\(uuid, uuid, text, text, timestamptz\) to service_role;/);
  // Duplicate completion stays an idempotent success.
  assert.match(completionV2Migration, /if v_log\.status = 'completed' then return v_log\.id; end if;/);
});

test('complete route forwards only a parseable local timestamp to v2', () => {
  assert.match(routesSource, /rpc\('complete_workout_log_v2'/);
  assert.match(routesSource, /completed_at_local/);
  assert.match(routesSource, /Number\.isNaN\(Date\.parse\(rawCompletedAt\)\)/);
});
