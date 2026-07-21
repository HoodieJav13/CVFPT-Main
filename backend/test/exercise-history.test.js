const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';

const {
  createExerciseHistoryHandler,
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

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function historyRequest(overrides = {}) {
  return {
    params: { id: 'active-log', exerciseId: 'active-exercise' },
    query: {},
    user: { role: 'client', client: { id: 'client-owned' } },
    ...overrides,
  };
}

function activeLog(exercise = {}) {
  return {
    id: 'active-log', client_id: 'client-owned', status: 'active', archived: false,
    exercises: [{
      id: 'active-exercise', archived: false, exercise_library_id: 'library-owned',
      source_workout_exercise_id: 'source-owned', ...exercise,
    }],
  };
}

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
  assert.match(routes, /createExerciseHistoryHandler\(\)/);
  assert.match(routes, /p_occurrence_limit: 11/);
  assert.match(routes, /allOccurrences\.slice\(0, 10\)/);
});

test('mounted history handler rejects an invalid cursor before any history access', async () => {
  let findCalls = 0;
  let rpcCalls = 0;
  const handler = createExerciseHistoryHandler({
    findLog: async () => { findCalls += 1; return activeLog(); },
    runHistory: async () => { rpcCalls += 1; return { data: [], error: null }; },
  });
  const res = responseRecorder();
  await handler(historyRequest({ query: { cursor: 'not-a-cursor' } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(findCalls, 0);
  assert.equal(rpcCalls, 0);
});

test('mounted history handler masks foreign, non-active, and wrong-exercise requests without RPC access', async (t) => {
  for (const [name, log] of [
    ['foreign log', { ...activeLog(), client_id: 'client-foreign' }],
    ['non-active log', { ...activeLog(), status: 'completed' }],
    ['archived log', { ...activeLog(), archived: true }],
    ['missing log', null],
  ]) {
    await t.test(name, async () => {
      let rpcCalls = 0;
      const handler = createExerciseHistoryHandler({
        findLog: async () => log,
        runHistory: async () => { rpcCalls += 1; return { data: [], error: null }; },
      });
      const res = responseRecorder();
      await handler(historyRequest(), res);
      assert.equal(res.statusCode, 404);
      assert.equal(res.body.error, 'Workout log not found');
      assert.equal(rpcCalls, 0);
    });
  }

  let rpcCalls = 0;
  const handler = createExerciseHistoryHandler({
    findLog: async () => activeLog(),
    runHistory: async () => { rpcCalls += 1; return { data: [], error: null }; },
  });
  const res = responseRecorder();
  await handler(historyRequest({ params: { id: 'active-log', exerciseId: 'cross-log-exercise' } }), res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'Workout exercise not found');
  assert.equal(rpcCalls, 0);
});

test('mounted history handler sends exact owned library and custom identities', async (t) => {
  for (const [name, exercise, expected] of [
    ['library', {}, { library: 'library-owned', source: 'source-owned' }],
    ['custom', { exercise_library_id: null, source_workout_exercise_id: 'custom-source' }, { library: null, source: 'custom-source' }],
  ]) {
    await t.test(name, async () => {
      let args;
      const handler = createExerciseHistoryHandler({
        findLog: async () => activeLog(exercise),
        runHistory: async (value) => { args = value; return { data: [], error: null }; },
      });
      const res = responseRecorder();
      await handler(historyRequest(), res);
      assert.equal(res.statusCode, 200);
      assert.equal(args.p_client_id, 'client-owned');
      assert.equal(args.p_exercise_library_id, expected.library);
      assert.equal(args.p_source_workout_exercise_id, expected.source);
      assert.equal(args.p_occurrence_limit, 11);
    });
  }
});

test('mounted history handler returns inline 500 when the history RPC fails', async () => {
  const handler = createExerciseHistoryHandler({
    findLog: async () => activeLog(),
    runHistory: async () => ({ data: null, error: new Error('database unavailable') }),
  });
  const res = responseRecorder();
  await handler(historyRequest(), res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: 'Failed to load exercise history' });
});

test('mounted history handler turns 11 stable occurrences into 10 plus a cursor and ordered sets', async () => {
  const rows = Array.from({ length: 11 }, (_, index) => {
    const suffix = String(index + 1).padStart(12, '0');
    const workoutLogId = `00000000-0000-4000-8000-${suffix}`;
    const completedAt = new Date(Date.UTC(2026, 6, 20 - index, 12)).toISOString();
    return [2, 1].map((setNumber) => ({
      workout_log_id: workoutLogId, completed_at: completedAt, exercise_name: `Snapshot ${index + 1}`,
      set_number: setNumber, actual_load_value: 20 + index, actual_load_unit: 'lb',
      actual_reps: 8, actual_rpe: 7.5,
    }));
  }).flat().reverse();
  const handler = createExerciseHistoryHandler({
    findLog: async () => activeLog(),
    runHistory: async () => ({ data: rows, error: null }),
  });
  const res = responseRecorder();
  await handler(historyRequest(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.occurrences.length, 10);
  assert.deepEqual(res.body.occurrences.map((row) => row.sets.map((set) => set.set_number)), Array(10).fill([1, 2]));
  const cursor = decodeHistoryCursor(res.body.next_cursor);
  assert.deepEqual(cursor, {
    completed_at: new Date(Date.UTC(2026, 6, 11, 12)).toISOString(),
    id: '00000000-0000-4000-8000-000000000010',
  });
});

test('permanent write failures advance the outbox while retryable failures retain ordering', () => {
  assert.match(tracker, /status >= 400 && status < 500 && status !== 408 && status !== 429/);
  assert.match(tracker, /filter\(\(queued\) => queued\.id !== operation\.id\)[\s\S]*continue;/);
  assert.match(tracker, /Math\.min\(30_000[\s\S]*setTimeout\(\(\) => flush\(\), delay\)[\s\S]*return false/);
  assert.doesNotMatch(tracker, /history[\s\S]{0,200}enqueue\(/i);
});
