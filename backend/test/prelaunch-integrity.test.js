const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '../../supabase/migrations/20260806120000_prelaunch_integrity.sql'),
  'utf8'
);

test('metric/check-in date defaults are Denver-local', () => {
  assert.match(migration, /metric_entries[\s\S]*?at time zone 'America\/Denver'/);
  assert.match(migration, /check_ins[\s\S]*?at time zone 'America\/Denver'/);
});

test('waiver tables get append-only triggers', () => {
  assert.match(migration, /before update or delete on public\.waiver_versions/);
  assert.match(migration, /before update or delete on public\.waiver_signatures/);
  assert.match(migration, /Waiver records are append-only/);
});

test('session durations are bounded so ranges can never be empty', () => {
  assert.match(migration, /sessions_duration_minutes_check[\s\S]*?between 1 and 480/);
  assert.match(migration, /booking_requests_duration_minutes_check[\s\S]*?between 1 and 480/);
});

test('client-keyed hot paths are indexed', () => {
  assert.match(migration, /idx_messages_client_created/);
  assert.match(migration, /idx_booking_requests_client_created/);
});

test('program import serializes exercise creation', () => {
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('cvf_exercise_library', 0\)\)/);
});

test('import RPC keeps service-role-only execution after redefinition', () => {
  assert.match(migration, /revoke execute on function public\.commit_program_import[\s\S]*?from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.commit_program_import\(uuid, text, jsonb\) to service_role/);
});
