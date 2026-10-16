const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
const { attachExerciseMedia } = require('../src/lib/exerciseMedia/hydration');
const { clientSafeProgramAssignment, clientSafeWorkoutAssignment, clientSafeExercise } = require('../src/lib/trainingLibrary');

const dto = (exerciseId) => ({ exercise_id: exerciseId, revision_id: 'r', version: 1, kind: 'photo', alt_text: 'Synthetic', cues: [], poster: { asset_id: 'a', width: 640, height: 360 }, end_frame: null, preview: null, instruction: null, transcript_available: false });

test('disabled media makes no lookup and leaves payloads byte-identical', async () => {
  const rows = [{ id: 'l1', exercise_library_id: 'lib1', video_url: 'https://youtu.be/x' }];
  let calls = 0;
  const out = await attachExerciseMedia(rows, (row) => row.exercise_library_id, { enabled: false, lookup: async () => { calls += 1; return new Map(); } });
  assert.equal(calls, 0);
  assert.deepEqual(out, rows);
  assert.equal(JSON.stringify(out), JSON.stringify(rows));
});

test('one batched lookup; logged id wins, legacy source id falls back, missing ids get null', async () => {
  const rows = [
    { id: 'l1', exercise_library_id: 'lib1' },
    { id: 'l2', exercise_library_id: null, source_workout_exercise_id: 'w2' },
    { id: 'l3', exercise_library_id: null, source_workout_exercise_id: null, custom_name: 'Custom, no library id' },
    { id: 'l4', exercise_library_id: 'lib1' },
  ];
  const sourceLibrary = new Map([['w2', 'lib2']]);
  const lookups = [];
  const out = await attachExerciseMedia(rows, (row) => row.exercise_library_id || sourceLibrary.get(row.source_workout_exercise_id), {
    enabled: true, lookup: async (ids) => { lookups.push(ids); return new Map([['lib1', dto('lib1')], ['lib2', dto('lib2')]]); },
  });
  assert.deepEqual(lookups, [['lib1', 'lib2']], 'deduplicated, no per-exercise N+1');
  assert.deepEqual(out.map((row) => row.media?.exercise_id ?? null), ['lib1', 'lib2', null, 'lib1']);
  assert.ok(out.every((row) => !('media_status' in row)));
  assert.equal(out[2].custom_name, 'Custom, no library id');
});

test('lookup failure keeps the workout readable: media null + unavailable status, external links untouched', async () => {
  const rows = [{ id: 'l1', exercise_library_id: 'lib1', video_url: 'https://youtu.be/coach' }, { id: 'l2', exercise_library_id: null }];
  const out = await attachExerciseMedia(rows, (row) => row.exercise_library_id, { enabled: true, lookup: async () => { throw Object.assign(new Error('down'), { code: 'PGRST000' }); } });
  assert.deepEqual(out[0], { id: 'l1', exercise_library_id: 'lib1', video_url: 'https://youtu.be/coach', media: null, media_status: 'unavailable' });
  assert.deepEqual(out[1], { id: 'l2', exercise_library_id: null, media: null });
});

test('client serializers pass media through nested programs/workouts and still drop private fields', () => {
  const exercise = { id: 'we1', workout_id: 'w1', exercise_library_id: 'lib1', custom_name: 'Synthetic Goblet Squat', video_url: 'https://youtu.be/x', coach_notes: 'private', media: dto('lib1'), media_status: 'unavailable', library_exercise: { id: 'lib1', name: 'Synthetic Goblet Squat', notes: 'private', hidden: true } };
  const safe = clientSafeExercise(exercise);
  assert.deepEqual(safe.media, dto('lib1'));
  assert.equal(safe.media_status, 'unavailable');
  assert.equal('coach_notes' in safe, false);
  assert.deepEqual(Object.keys(safe.library_exercise).sort(), ['id', 'name']);
  const workout = { id: 'w1', name: 'Synthetic', created_by: 'coach', exercises: [exercise] };
  const program = { id: 'p1', name: 'P', created_by: 'coach', days: [{ id: 'd1', program_id: 'p1', day_number: 1, workout_id: 'w1', workout }] };
  const viaProgram = clientSafeProgramAssignment({ id: 'pa1', client_id: 'c1', program_id: 'p1', program }).program.days[0].workout.exercises[0];
  const viaWorkout = clientSafeWorkoutAssignment({ id: 'wa1', client_id: 'c1', workout_id: 'w1', workout }).workout.exercises[0];
  for (const row of [viaProgram, viaWorkout]) {
    assert.deepEqual(row.media, dto('lib1'));
    assert.equal('coach_notes' in row, false);
  }
});
