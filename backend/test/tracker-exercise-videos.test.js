const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
const { resolveExerciseVideos } = require('../src/routes/workoutLogs');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('tracker videos: the workout link wins, then the library link, http(s) only', () => {
  const logged = [
    { id: 'l1', source_workout_exercise_id: 'w1', exercise_library_id: 'lib1' },
    { id: 'l2', source_workout_exercise_id: 'w2', exercise_library_id: 'lib2' },
    { id: 'l3', source_workout_exercise_id: 'w3', exercise_library_id: null },
    { id: 'l4', source_workout_exercise_id: 'w4', exercise_library_id: null },
    { id: 'l5', source_workout_exercise_id: null, exercise_library_id: 'lib1' },
    { id: 'l6', source_workout_exercise_id: 'gone', exercise_library_id: null },
  ];
  const workoutRows = [
    { id: 'w1', video_url: 'https://youtu.be/coach', exercise_library_id: 'lib1' },
    { id: 'w2', video_url: '', exercise_library_id: 'lib2' },
    { id: 'w3', video_url: 'javascript:alert(1)', exercise_library_id: null },
    // Older snapshots may lack the library id; the source row supplies it.
    { id: 'w4', video_url: null, exercise_library_id: 'lib2' },
  ];
  const library = [
    { id: 'lib1', video_url: 'https://youtu.be/library-1' },
    { id: 'lib2', video_url: 'http://example.com/library-2' },
  ];
  const videos = resolveExerciseVideos(logged, workoutRows, library).map((row) => [row.id, row.video_url]);
  assert.deepEqual(videos, [
    ['l1', 'https://youtu.be/coach'],
    ['l2', 'http://example.com/library-2'],
    ['l3', null],
    ['l4', 'http://example.com/library-2'],
    ['l5', 'https://youtu.be/library-1'],
    ['l6', null],
  ]);
});

test('tracker videos are resolved live for the single-log read and rendered safely', () => {
  const routes = read('backend/src/routes/workoutLogs.js');
  const tracker = read('frontend/src/pages/client/WorkoutTracker.jsx');
  assert.match(routes, /const exercises = await withExerciseVideos\(loggedExercises \|\| \[\]\);/);
  // Read-only lookups; no writes to the snapshot.
  assert.match(routes, /from\('workout_exercises'\)\s*\.select\('id, video_url, exercise_library_id'\)/);
  assert.match(routes, /from\('exercise_library'\)\s*\.select\('id, video_url'\)/);
  assert.match(tracker, /href=\{safeHttpUrl\(exercise\.video_url\)\}/);
  assert.match(tracker, /rel="noopener noreferrer"/);
});
