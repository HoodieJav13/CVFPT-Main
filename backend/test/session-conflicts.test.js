const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260730220646_session_conflict_protection.sql'),
  'utf8',
);
const sessionRoutes = fs.readFileSync(path.join(root, 'backend', 'src', 'routes', 'sessions.js'), 'utf8');
const bookingRoutes = fs.readFileSync(path.join(root, 'backend', 'src', 'routes', 'bookings.js'), 'utf8');

test('conflict decisions S1-S4 are encoded in the migration', () => {
  // S2: half-open range so back-to-back sessions never collide.
  assert.match(migration, /tstzrange\(p_scheduled_at, p_scheduled_at \+ make_interval\(mins => p_duration_minutes\), '\[\)'\)/);
  // S3: cancelled sessions are excluded from every scan and constraint.
  assert.match(migration, /status <> 'cancelled' and archived = false and capacity = 1/);
  // S4: capacity column with sane floor.
  assert.match(migration, /capacity integer not null default 1 check \(capacity >= 1\)/);
  // S1: both hard-block scopes exist as exclusion backstops.
  assert.match(migration, /add constraint sessions_no_coach_overlap\s+exclude using gist/);
  assert.match(migration, /add constraint sessions_no_client_overlap\s+exclude using gist/);
  // S1: location is advisory — counted, never an exclusion constraint.
  assert.match(migration, /lower\(btrim\(s\.location\)\) = lower\(btrim\(p_location\)\)/);
  assert.doesNotMatch(migration, /exclude using gist \(\s*location/);
});

test('scheduling is serialized and pre-flighted', () => {
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\('cvf_session_scheduling'\)\)/);
  // Apply-time pre-flight refuses to enable over already-overlapping data.
  assert.match(migration, /Cannot enable session conflict protection/);
  // Reschedules never conflict with themselves.
  assert.match(migration, /p_session_id is null or s\.id <> p_session_id/);
});

test('conflict RPCs are invoker-security and service-role-only', () => {
  for (const [name, signature] of [
    ['schedule_session', 'uuid, uuid, uuid, timestamptz, integer, text, boolean'],
    ['session_time_range', 'timestamptz, integer'],
  ]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${name}[\\s\\S]*?(security invoker[\\s\\S]*?set search_path = ''|immutable[\\s\\S]*?set search_path = '')`));
    assert.match(migration, new RegExp(`revoke execute on function public\\.${name}\\(${signature.replace(/[()]/g, '\\$&')}\\) from public, anon, authenticated;`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${name}\\(${signature.replace(/[()]/g, '\\$&')}\\) to service_role;`));
  }
  assert.match(migration, /create or replace function public\.approve_booking\(p_booking_id uuid\)[\s\S]*?security invoker/);
});

test('session create and reschedule flow through schedule_session', () => {
  assert.match(sessionRoutes, /rpc\('schedule_session', \{\s*p_session_id: null/);
  assert.match(sessionRoutes, /rpc\('schedule_session', \{\s*p_session_id: session\.id/);
  // No remaining direct insert into sessions from the route layer.
  assert.doesNotMatch(sessionRoutes, /from\('sessions'\)\.insert/);
  // Conflicts surface as 409 with a structured scope.
  assert.match(sessionRoutes, /status\(409\)\.json\(conflictResponse\(data\)\)/);
  assert.match(sessionRoutes, /scope: result\.outcome === 'client_conflict' \? 'client' : 'coach'/);
});

test('booking approval refuses conflicts and keeps the request pending', () => {
  assert.match(migration, /if v_result->>'outcome' <> 'scheduled' then\s*return v_result;/);
  assert.match(bookingRoutes, /data\.outcome === 'coach_conflict' \|\| data\.outcome === 'client_conflict'/);
  assert.match(bookingRoutes, /The request stays pending/);
  assert.match(bookingRoutes, /status\(409\)/);
});

const relocationMigration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260731071500_relocate_btree_gist.sql'),
  'utf8',
);

test('btree_gist is relocated out of public per Supabase lint', () => {
  assert.match(relocationMigration, /alter extension btree_gist set schema extensions;/);
  assert.match(relocationMigration, /create schema if not exists extensions;/);
});
