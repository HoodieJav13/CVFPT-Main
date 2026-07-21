const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const {
  decodeHistoryCursor,
  updateSetAtHandlerBoundary,
  workoutSetUpdatePayload,
} = require('../src/routes/workoutLogs');

const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260720173000_exercise_performance_history.sql'), 'utf8');
const routes = fs.readFileSync(path.join(__dirname, '../src/routes/workoutLogs.js'), 'utf8');
const tracker = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/client/WorkoutTracker.jsx'), 'utf8');

const storedSet = {
  status: 'pending', actual_load_value: 30, actual_load_unit: 'lb', actual_reps: null, actual_rpe: null,
};

test('strict performed fields reject malformed types/domains before mutation', async () => {
  const invalid = [
    { actual_reps: '8' }, { actual_reps: true }, { actual_reps: [] }, { actual_reps: {} },
    { actual_reps: NaN }, { actual_reps: 1.5 }, { actual_reps: -1 },
    { actual_rpe: '8' }, { actual_rpe: false }, { actual_rpe: [] }, { actual_rpe: {} },
    { actual_rpe: NaN }, { actual_rpe: 0.5 }, { actual_rpe: 10.5 }, { actual_rpe: 7.25 },
  ];
  let mutationCalls = 0;
  for (const body of invalid) {
    await assert.rejects(
      updateSetAtHandlerBoundary({ body, set: storedSet, mutate: async () => { mutationCalls += 1; } }),
      (error) => error.status === 400,
    );
  }
  assert.equal(mutationCalls, 0);
});

test('null, absent, and valid performed fields produce exact update payloads', () => {
  assert.deepEqual(workoutSetUpdatePayload({}, { ...storedSet, actual_reps: 6, actual_rpe: 7.5 }, 'now'), {
    status: 'pending', actual_load_value: 30, actual_load_unit: 'lb', actual_reps: 6, actual_rpe: 7.5,
    completed_at: null, updated_at: 'now',
  });
  assert.equal(workoutSetUpdatePayload({ actual_reps: 0, actual_rpe: 10 }, storedSet, 'now').actual_reps, 0);
  assert.equal(workoutSetUpdatePayload({ actual_reps: null, actual_rpe: null }, storedSet, 'now').actual_rpe, null);
});

test('opaque history cursor validation rejects malformed input without data access', () => {
  for (const cursor of ['', 1, 'not-base64', Buffer.from('{}').toString('base64url'),
    Buffer.from(JSON.stringify({ completed_at: 'nope', id: 'also-nope' })).toString('base64url')]) {
    assert.throws(() => decodeHistoryCursor(cursor));
  }
  const valid = { completed_at: '2026-07-20T12:00:00.000Z', id: '123e4567-e89b-42d3-a456-426614174000' };
  assert.deepEqual(decodeHistoryCursor(Buffer.from(JSON.stringify(valid)).toString('base64url')), valid);
});

test('migration enforces snapshots, backfill, completed-only identity history, and service-role execution', () => {
  assert.match(migration, /add column actual_reps integer/);
  assert.match(migration, /actual_rpe between 1 and 10[\s\S]*actual_rpe \* 2 = trunc/);
  assert.match(migration, /set exercise_library_id = we\.exercise_library_id[\s\S]*source_workout_exercise_id = we\.id/);
  assert.match(migration, /v_exercise\.exercise_library_id, v_exercise\.resolved_name/);
  assert.match(migration, /l\.status = 'completed'[\s\S]*l\.archived = false/);
  assert.match(migration, /s\.archived = false and s\.status = 'completed'/);
  assert.match(migration, /e\.exercise_library_id = p_exercise_library_id/);
  assert.match(migration, /e\.source_workout_exercise_id = p_source_workout_exercise_id/);
  assert.doesNotMatch(migration, /lower\(.*exercise_name|normalize/i);
  assert.match(migration, /revoke execute on function public\.get_workout_exercise_history[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.get_workout_exercise_history[\s\S]*to service_role/);
});

test('history route is ordered before generic detail and uses active ownership plus 11-occurrence lookahead', () => {
  assert.ok(routes.indexOf("router.get('/:id/exercises/:exerciseId/history'") < routes.indexOf("router.get('/:id',"));
  assert.match(routes, /const log = await requireOwnedActiveLog\(req, res\)/);
  assert.match(routes, /p_occurrence_limit: 11/);
  assert.match(routes, /allOccurrences\.slice\(0, 10\)/);
});

test('permanent write failures advance the outbox while retryable failures retain ordering', () => {
  assert.match(tracker, /status >= 400 && status < 500 && status !== 408 && status !== 429/);
  assert.match(tracker, /filter\(\(queued\) => queued\.id !== operation\.id\)[\s\S]*continue;/);
  assert.match(tracker, /Math\.min\(30_000[\s\S]*setTimeout\(\(\) => flush\(\), delay\)[\s\S]*return false/);
  assert.doesNotMatch(tracker, /history[\s\S]{0,200}enqueue\(/i);
});
