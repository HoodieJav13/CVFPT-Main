const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260731173247_structured_rest.sql'),
  'utf8',
);
const tracker = fs.readFileSync(path.join(root, 'frontend', 'src', 'pages', 'client', 'WorkoutTracker.jsx'), 'utf8');
const restLib = fs.readFileSync(path.join(root, 'frontend', 'src', 'lib', 'rest.js'), 'utf8');
const builder = fs.readFileSync(path.join(root, 'frontend', 'src', 'pages', 'coach', 'Programs.jsx'), 'utf8');

test('structured rest schema: parser, columns, range checks, service-role only', () => {
  assert.match(migration, /create or replace function public\.parse_rest_seconds[\s\S]*?immutable[\s\S]*?set search_path = ''/);
  assert.match(migration, /add column if not exists rest_seconds integer/);
  assert.match(migration, /add column if not exists prescribed_rest_seconds integer/);
  assert.match(migration, /rest_seconds >= 0 and rest_seconds <= 36000/);
  assert.match(migration, /prescribed_rest_seconds >= 0 and prescribed_rest_seconds <= 36000/);
  assert.match(migration, /revoke execute on function public\.parse_rest_seconds\(text\) from public, anon, authenticated;/);
  assert.match(migration, /grant execute on function public\.parse_rest_seconds\(text\) to service_role;/);
});

test('backfill converts mutable logs only — completed snapshots stay immutable', () => {
  // The log backfill must join workout_logs and exclude completed status,
  // or the immutability trigger aborts the whole migration.
  assert.match(migration, /update public\.workout_log_exercises wle[\s\S]*?wl\.status <> 'completed'/);
  assert.match(migration, /update public\.workout_exercises\s*set rest_seconds = public\.parse_rest_seconds\(rest\)/);
});

test('fill triggers keep every writer consistent, explicit values winning', () => {
  assert.match(migration, /create trigger fill_workout_exercise_rest\s*before insert or update on public\.workout_exercises/);
  assert.match(migration, /create trigger fill_workout_log_exercise_rest\s*before insert or update on public\.workout_log_exercises/);
  // Both trigger bodies only act when the incoming value is null.
  assert.match(migration, /if new\.rest_seconds is null then/);
  assert.match(migration, /if new\.prescribed_rest_seconds is null then/);
  // The snapshot path copies the source exercise's seconds before parsing text.
  assert.match(migration, /from public\.workout_exercises\s*where id = new\.source_workout_exercise_id/);
});

test('tracker reads the structured column and never parses rest text', () => {
  assert.match(tracker, /exercise\.prescribed_rest_seconds > 0/);
  assert.doesNotMatch(tracker, /function parseRest\b/);
  assert.doesNotMatch(tracker, /parseRestSeconds/);
  // Display falls back to legacy text; the timer never does.
  assert.match(tracker, /formatRestSeconds\(exercise\.prescribed_rest_seconds\)/);
});

test('rest timer is durable and end-of-rest alerts are opt-in with capability checks', () => {
  assert.match(tracker, /cvf_rest_timer_\$\{id\}/);
  assert.match(tracker, /localStorage\.setItem\(restStorageKey/);
  assert.match(tracker, /stored > Date\.now\(\)/);
  // Alerts default off, persist as a preference, and probe capabilities.
  assert.match(tracker, /localStorage\.getItem\('cvf_rest_alerts'\) === 'on'/);
  assert.match(tracker, /typeof navigator\.vibrate === 'function'/);
  assert.match(tracker, /window\.AudioContext \|\| window\.webkitAudioContext/);
});

test('builder authors rest numerically; shared parser mirrors the SQL range', () => {
  assert.match(builder, /type="number" min="0" step="5" inputMode="numeric"/);
  assert.match(builder, /parseRestSeconds\(exercise\.rest\) \?\? ''/);
  assert.match(restLib, /seconds >= 0 && seconds <= 36000/);
});
