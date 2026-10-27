const test = require('node:test');
const assert = require('node:assert/strict');
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
const { workoutSetUpdatePayload, updateSetAtHandlerBoundary } = require('../src/routes/workoutLogs');
const stored = { status: 'pending', actual_load_value: null, actual_load_unit: null, actual_reps: null, actual_rpe: null };

test('duration and distance retain their explicit units through repeated partial saves', () => {
  const exercise = { tracking_type: 'duration_distance' };
  const body = { actual_duration_value: 12.5, actual_duration_unit: 'min', actual_distance_value: 1.25, actual_distance_unit: 'mi' };
  const saved = workoutSetUpdatePayload(body, stored, 'now', exercise);
  assert.equal(saved.actual_duration_value, 12.5);
  assert.equal(saved.actual_duration_unit, 'min');
  assert.equal(saved.actual_distance_value, 1.25);
  assert.equal(saved.actual_distance_unit, 'mi');
  assert.deepEqual(workoutSetUpdatePayload({}, saved, 'now', exercise), saved);
  assert.equal(workoutSetUpdatePayload({ actual_duration_value: null, actual_duration_unit: null }, saved, 'now', exercise).actual_duration_value, null);
});

test('metric limits match exact decimal database arithmetic at the mile/yard boundary', () => {
  const { metricPair } = require('../src/lib/workoutMetrics');
  for (const [value, unit] of [[621.371192237334, 'mi'], [1093613.2983377078, 'yd']]) assert.throws(() => metricPair(value, unit, 'distance'), (error) => error.status === 400);
  assert.equal(metricPair(621.3711922373339, 'mi', 'distance').value, 621.3711922373339);
  assert.equal(metricPair(0.000000001, 'min', 'duration').value, 0.000000001);
  assert.equal(metricPair(1440, 'min', 'duration').value, 1440);
});

test('offline queue requires explicit acknowledgement of metric values and units', async () => {
  const { metricWriteAcknowledged } = await import('../../frontend/src/lib/workoutSync.js');
  const request = { actual_duration_value: 12.5, actual_duration_unit: 'min', actual_distance_value: 1.25, actual_distance_unit: 'mi' };
  assert.equal(metricWriteAcknowledged(request, { ...request }), true);
  assert.equal(metricWriteAcknowledged(request, { ...request, actual_duration_value: null }), false);
  assert.equal(metricWriteAcknowledged(request, { status: 'completed' }), false);
  assert.equal(metricWriteAcknowledged({ actual_distance_value: null, actual_distance_unit: null }, { actual_distance_value: 1, actual_distance_unit: 'mi' }), false);
  assert.equal(metricWriteAcknowledged({ actual_reps: 8 }, { actual_reps: 8 }), true);
});

test('tracker validation rejects invalid reps/RPE before completion or rest can start', async () => {
  const { performedSet } = await import('../../frontend/src/lib/workoutMetrics.js');
  for (const fields of [{ actual_reps: '8.5' }, { actual_rpe: '11' }, { actual_rpe: '7.25' }]) assert.throws(() => performedSet({ ...stored, ...fields }, {}), (error) => error.status === 400);
  assert.equal(performedSet({ ...stored, actual_reps: '0', actual_rpe: '7.5' }, {}).actual_rpe, 7.5);
});

test('history keeps duplicate library snapshots separate and never splits a workout at a cursor', async () => {
  const { createExerciseHistoryHandler } = require('../src/routes/workoutLogs');
  const rows = [];
  for (let index = 11; index >= 1; index--) {
    const id = String(index).padStart(2, '0');
    const base = { workout_log_id: id, completed_at: '2026-10-05T10:00:00Z', exercise_name: 'Repeated library exercise', set_number: 1, actual_load_value: null, actual_load_unit: null, actual_reps: null, actual_rpe: null };
    rows.push({ ...base, workout_log_exercise_id: `${id}-duration`, tracking_type: 'duration', actual_duration_value: 10, actual_duration_unit: 'min' });
    rows.push({ ...base, workout_log_exercise_id: `${id}-distance`, tracking_type: 'distance', actual_distance_value: 2, actual_distance_unit: 'km' });
  }
  const handler = createExerciseHistoryHandler({ findLog: async () => ({ status: 'active', client_id: 'c', exercises: [{ id: 'ex', exercise_library_id: 'lib' }] }), runHistory: async () => ({ data: rows, error: null }) });
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ params: { id: 'active', exerciseId: 'ex' }, user: { role: 'client', client: { id: 'c' } }, query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.occurrences.length, 20);
  assert.equal(new Set(res.body.occurrences.map((row) => row.occurrence_id)).size, 20);
  assert.equal(res.body.occurrences.every((row) => row.sets.length === 1), true);
  assert.equal(res.body.occurrences.filter((row) => row.tracking_type === 'duration').every((row) => row.sets[0].actual_duration_value === 10), true);
  assert.equal(JSON.parse(Buffer.from(res.body.next_cursor, 'base64url')).id, '02');
  assert.equal(res.body.occurrences.some((row) => row.workout_log_id === '01'), false);
});

test('malformed, mismatched and out-of-range metric writes never mutate', async () => {
  let writes = 0;
  for (const body of [
    { actual_duration_value: '30', actual_duration_unit: 's' },
    { actual_duration_value: true, actual_duration_unit: 's' },
    { actual_duration_value: 0, actual_duration_unit: 's' },
    { actual_duration_value: -1, actual_duration_unit: 'min' },
    { actual_duration_value: Infinity, actual_duration_unit: 's' },
    { actual_duration_value: 1441, actual_duration_unit: 'min' },
    { actual_duration_value: 30, actual_duration_unit: 'hr' },
    { actual_duration_value: 30, actual_duration_unit: 'constructor' },
    { actual_distance_value: 30, actual_distance_unit: 'toString' },
    { actual_duration_value: null, actual_duration_unit: 's' },
    { actual_distance_value: 3, actual_distance_unit: null },
    { actual_distance_value: 1001, actual_distance_unit: 'km' },
    { actual_distance_value: [], actual_distance_unit: 'm' },
    { actual_distance_value: NaN, actual_distance_unit: 'm' },
    { actual_reps: 8 },
  ]) {
    await assert.rejects(updateSetAtHandlerBoundary({ body, set: stored, exercise: { tracking_type: 'duration_distance' }, mutate: () => { writes++; } }), (e) => e.status === 400, JSON.stringify(body));
  }
  await assert.rejects(updateSetAtHandlerBoundary({ body: { actual_distance_value: 20, actual_distance_unit: 'm' }, set: stored, exercise: { tracking_type: 'duration' }, mutate: () => { writes++; } }), (e) => e.status === 400);
  await assert.rejects(updateSetAtHandlerBoundary({ body: { actual_duration_value: 20, actual_duration_unit: 's', tracking_type: 'duration' }, set: stored, exercise: {}, mutate: () => { writes++; } }), (e) => e.status === 400);
  assert.equal(writes, 0);
});

test('offline add reconciliation keeps typed duration and distance with units', async () => {
  const { reconcileAddedSet, lastTimeFills } = await import('../../frontend/src/lib/workoutSync.js');
  const optimistic = { ...stored, id: 'pending-op', set_number: 1, actual_duration_value: '30', actual_duration_unit: 'min', actual_distance_value: '2', actual_distance_unit: 'km' };
  const reconciled = reconcileAddedSet(optimistic, { ...stored, id: 'real', actual_duration_value: null, actual_distance_value: null });
  assert.equal(reconciled.actual_duration_value, '30');
  assert.equal(reconciled.actual_distance_unit, 'km');
  const exercise = { tracking_type: 'duration_distance' };
  const previous = { tracking_type: 'duration_distance', sets: [{ ...stored, set_number: 1, actual_duration_value: 45, actual_duration_unit: 's', actual_distance_value: 100, actual_distance_unit: 'yd' }] };
  assert.deepEqual(lastTimeFills([optimistic], previous, exercise), []);
  assert.deepEqual(lastTimeFills([optimistic], { ...previous, tracking_type: 'reps_weight' }, exercise), []);
  const fills = lastTimeFills([{ ...stored, id: 's1', set_number: 1 }], previous, exercise);
  assert.equal(fills[0].data.actual_duration_unit, 's');
  assert.equal(fills[0].data.actual_distance_value, 100);
});

test('coach tracking validation is explicit and identical across deploy roots', async () => {
  const backend = require('../src/lib/workoutMetrics');
  const frontend = await import('../../frontend/src/lib/workoutMetrics.js');
  for (const ex of [{ custom_name: 'Run', category: 'Cardio' }, { tracking_type: 'duration', duration_value: '45', duration_unit: 's' }, { tracking_type: 'duration_distance', duration_value: '1.25', duration_unit: 'min', distance_value: '200', distance_unit: 'yd' }]) {
    assert.deepEqual(backend.normalizeTracking(ex), frontend.normalizeTracking(ex));
  }
  assert.equal(backend.normalizeTracking({ custom_name: 'Run', category: 'Cardio' }).tracking_type, 'reps_weight');
  for (const ex of [{ tracking_type: 'swimming' }, { tracking_type: 'distance', duration_value: 2, duration_unit: 'min' }, { tracking_type: 'duration', duration_value: false, duration_unit: 's' }]) assert.throws(() => backend.normalizeTracking(ex), (e) => e.status === 400);
});

test('program draft round trips typed targets and rejects invalid tracking', async () => {
  const backend = require('../src/lib/programDraft.cjs');
  const frontend = await import('../../frontend/src/lib/programDraft.js');
  const program = { name: 'Typed plan', frequency_days: 1, days: [{ day_number: 1, workout: { name: 'Conditioning', exercises: [{ custom_name: 'Run', tracking_type: 'duration_distance', duration_value: 12, duration_unit: 'min', distance_value: 1.5, distance_unit: 'mi' }] } }] };
  const draft = backend.draftFromProgram(program);
  assert.equal(draft.days[0].exercises[0].tracking_type, 'duration_distance');
  assert.equal(draft.days[0].exercises[0].distance_unit, 'mi');
  assert.deepEqual(draft, frontend.draftFromProgram(program));
  draft.import_meta.source_type = 'paste';
  assert.equal(backend.validateDraft(draft).valid, true);
  draft.days[0].exercises[0].duration_unit = 'hours';
  assert.equal(backend.validateDraft(draft).valid, false);
});

test('printable program and log sheet show typed targets and performed unit labels', async () => {
  const { generateProgramPdf, generateLogSheetPdf } = require('../src/lib/programPdf');
  const { extractPdfText } = require('../src/lib/pdfText');
  const exercises = [{ custom_name: 'Run', sets: '1', tracking_type: 'duration_distance', duration_value: 12.5, duration_unit: 'min', distance_value: 1.25, distance_unit: 'mi' }];
  const program = await extractPdfText(await generateProgramPdf({ name: 'Typed', days: [{ day_number: 1, workout: { name: 'Conditioning', exercises } }] }, { coach: { name: 'Synthetic' } }));
  assert.match(program, /Duration: 12\.5 min/);
  assert.match(program, /Distance: 1\.25 mi/);
  const log = await extractPdfText(await generateLogSheetPdf({ title: 'Typed', sections: [{ title: 'Conditioning', exercises }] }));
  assert.match(log, /Duration: 12\.5 min/);
  assert.match(log, /Distance: 1\.25 mi/);
  assert.match(log, /Time \(min\)/);
  assert.match(log, /Dist \(mi\)/);
});

test('legacy CSV and new optional blank tracking columns default to reps/weight', () => {
  const { parseCsvDraft, validateDraft } = require('../src/lib/programDraft.cjs');
  for (const extra of ['', ',tracking_type,duration_value,duration_unit,distance_value,distance_unit']) {
    const csv = `program_name,frequency_days,day_number,workout_name,exercise_name${extra}\nLegacy,3,1,Day 1,Run${extra ? ',,,,,' : ''}\nLegacy,3,2,Day 2,Hold${extra ? ',,,,,' : ''}\nLegacy,3,3,Day 3,Squat${extra ? ',,,,,' : ''}`;
    const draft = parseCsvDraft(csv);
    assert.equal(validateDraft(draft).valid, true);
    assert.equal(draft.days[0].exercises[0].tracking_type, 'reps_weight');
  }
});
