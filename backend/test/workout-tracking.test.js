const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260717043317_workout_tracking_notifications.sql'),
  'utf8',
);
const workoutRoutes = fs.readFileSync(path.join(root, 'backend', 'src', 'routes', 'workoutLogs.js'), 'utf8');
const notificationRoutes = fs.readFileSync(path.join(root, 'backend', 'src', 'routes', 'notifications.js'), 'utf8');
const programRoutes = fs.readFileSync(path.join(root, 'backend', 'src', 'routes', 'programs.js'), 'utf8');

test('workout tracking tables stay locked behind the service role', () => {
  for (const table of [
    'program_assignment_exercise_loads',
    'workout_assignment_exercise_loads',
    'workout_logs',
    'workout_log_exercises',
    'workout_log_sets',
    'notifications',
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security;`));
    assert.match(migration, new RegExp(`revoke all privileges on table public\\.${table} from public, anon, authenticated, service_role;`));
    assert.match(migration, new RegExp(`grant select, insert, update on table public\\.${table} to service_role;`));
  }
});

test('transactional workout RPCs are invoker-security and service-role-only', () => {
  for (const [name, signature] of [
    ['save_program_assignment_with_loads', 'uuid, uuid, uuid, text, jsonb'],
    ['save_workout_assignment_with_loads', 'uuid, uuid, uuid, text, date, text, jsonb'],
    ['start_workout_log', 'uuid, uuid, uuid, uuid'],
    ['complete_all_workout_sets', 'uuid, uuid'],
    ['complete_workout_log', 'uuid, uuid, text, text'],
  ]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${name}[\\s\\S]*?security invoker[\\s\\S]*?set search_path = ''`));
    assert.match(migration, new RegExp(`revoke execute on function public\\.${name}\\(${signature}\\) from public, anon, authenticated;`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${name}\\(${signature}\\) to service_role;`));
  }
});

test('workout integrity is encoded in database constraints and triggers', () => {
  assert.match(migration, /idx_workout_logs_one_active_per_client[\s\S]*?where status = 'active' and archived = false/);
  assert.match(migration, /idx_workout_logs_one_dated_completion[\s\S]*?status in \('active', 'completed'\)/);
  assert.match(migration, /exception when unique_violation[\s\S]*?'outcome', 'resumed'[\s\S]*?'outcome', 'conflict'/);
  assert.match(migration, /unique\(recipient_coach_id, event_type, workout_log_id\)/);
  assert.match(migration, /prevent_completed_workout_log_change/);
  assert.match(migration, /prevent_completed_workout_child_change/);
  assert.match(migration, /on conflict \(recipient_coach_id, event_type, workout_log_id\) do nothing/);
});

test('snapshot load precedence and completion remain server-owned', () => {
  assert.match(migration, /from public\.program_assignment_exercise_loads[\s\S]*?if v_load_value is null then[\s\S]*?v_exercise\.default_load_value/);
  assert.match(migration, /insert into public\.workout_log_exercises/);
  assert.match(migration, /v_completed_count < 1/);
  assert.match(migration, /set status = 'skipped'/);
  assert.doesNotMatch(migration, /client_credits/);
  assert.doesNotMatch(workoutRoutes, /client_credits/);
});

test('HTTP surfaces require role checks and mask inaccessible workout data', () => {
  assert.match(workoutRoutes, /router\.post\('\/start', requireClient/);
  assert.match(workoutRoutes, /router\.get\('\/client\/:clientId', requireCoach/);
  assert.match(workoutRoutes, /return res\.status\(404\)\.json\(\{ error: 'Workout log not found' \}\)/);
  assert.match(workoutRoutes, /if \(\/not found\|Assigned workout\/i\.test\(message\)\) return 404/);
  assert.match(notificationRoutes, /router\.use\(requireAuth, requireCoach\)/);
  assert.match(notificationRoutes, /eq\('recipient_coach_id', user\.coach\.id\)/);
  assert.match(programRoutes, /rpc\('save_program_assignment_with_loads'/);
  assert.match(programRoutes, /rpc\('save_workout_assignment_with_loads'/);
});
