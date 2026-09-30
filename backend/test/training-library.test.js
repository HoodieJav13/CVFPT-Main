const test = require('node:test');
const assert = require('node:assert/strict');
const {
  clientSafeExercise,
  clientSafeProgram,
  clientSafeProgramAssignment,
  clientSafeWorkout,
  clientSafeWorkoutAssignment,
  filterByAuthor,
  withAuthor,
} = require('../src/lib/trainingLibrary');

const PRIVATE_KEYS = [
  'created_by', 'author', 'hidden', 'is_template', 'client_id', 'variation_of',
  'source_program_id', 'source_workout_id', 'coach_id', 'coach_notes', 'assignments', 'review_status', 'source',
];

function leaks(value, path = '$') {
  const found = [];
  if (Array.isArray(value)) {
    value.forEach((item, i) => found.push(...leaks(item, `${path}[${i}]`)));
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      // client_id is legitimately part of the client's own assignment row.
      if (PRIVATE_KEYS.includes(key) && !(key === 'client_id' && /assignment|\$$/.test(path))) found.push(`${path}.${key}`);
      found.push(...leaks(child, `${path}.${key}`));
    }
  }
  return found;
}

const exercise = {
  id: 'e1', workout_id: 'w1', exercise_library_id: 'l1', custom_name: null, sets: '3', reps: '5',
  rest: '90 sec', rest_seconds: 90, tempo: null, target_rpe: '8', default_load_value: 100, default_load_unit: 'lb',
  notes: 'n', client_notes: 'cue', coach_notes: 'PRIVATE', video_url: null, position: 0, archived: false,
  created_at: 't', future_column: 'not on the allowlist',
  library_exercise: {
    id: 'l1', name: 'Squat', category: 'legs', equipment: 'bar', primary_muscle: 'quads', secondary_muscles: null,
    video_url: null, notes: 'library coach note', source: 'manual', review_status: 'approved', hidden: false,
  },
};
const workout = {
  id: 'w1', coach_id: 'coach', name: 'Lower', description: 'd', goal: 'g', archived: false, created_at: 't', updated_at: 't',
  is_template: false, client_id: 'c1', source_workout_id: 't1', variation_of: null, hidden: false, created_by: 'coach',
  author: { id: 'coach', name: 'Coach A' }, exercises: [exercise], exercise_count: 1,
};
const program = {
  id: 'p1', coach_id: 'coach', name: 'P', description: null, frequency_days: 3, archived: false, created_at: 't',
  is_template: false, client_id: 'c1', source_program_id: 't1', variation_of: null, hidden: false, created_by: 'coach',
  days: [{ id: 'd1', program_id: 'p1', day_number: 1, workout_id: 'w1', notes: null, archived: false, created_at: 't', workout }],
  assignments: [{ id: 'a9', client: { id: 'other', name: 'Another Client' } }],
};

test('client-facing serializers drop attribution, provenance, hidden flag, coach notes, and other clients', () => {
  const safeProgram = clientSafeProgram(program);
  const safeWorkout = clientSafeWorkout(workout);
  const safeAssignment = clientSafeProgramAssignment({
    id: 'a1', program_id: 'p1', client_id: 'c1', notes: null, archived: false, created_at: 't',
    exercise_loads: [{ id: 'l', load_value: 135 }], program,
  });
  const safeWorkoutAssignment = clientSafeWorkoutAssignment({
    id: 'a2', client_id: 'c1', workout_id: 'w1', assignment_mode: 'active', assigned_for: null,
    notes: null, archived: false, created_at: 't', workout,
  });
  for (const [label, value] of [['program', safeProgram], ['workout', safeWorkout], ['program assignment', safeAssignment], ['workout assignment', safeWorkoutAssignment]]) {
    assert.deepEqual(leaks(value), [], `${label} must not expose private fields`);
  }
  assert.equal(JSON.stringify(safeAssignment).includes('Another Client'), false);
  assert.equal(JSON.stringify(safeAssignment).includes('PRIVATE'), false);
  assert.equal(JSON.stringify(safeAssignment).includes('Coach A'), false);
});

test('client serializers keep everything the client pages read', () => {
  const safe = clientSafeExercise(exercise);
  for (const key of ['id', 'sets', 'reps', 'rest', 'rest_seconds', 'tempo', 'target_rpe', 'default_load_value', 'default_load_unit', 'notes', 'client_notes', 'custom_name', 'video_url']) {
    assert.ok(key in safe, `${key} must reach the client`);
  }
  assert.equal(safe.library_exercise.name, 'Squat');
  assert.equal('coach_notes' in safe, false);
  assert.equal('future_column' in safe, false, 'unlisted columns are private by default');
  const safeProgram = clientSafeProgram(program);
  assert.equal(safeProgram.days[0].workout.exercises[0].library_exercise.name, 'Squat');
  assert.equal(safeProgram.days[0].day_number, 1);
  assert.equal(safeProgram.frequency_days, 3);
});

test('serializers tolerate missing relations', () => {
  assert.equal(clientSafeProgram(null), null);
  assert.equal(clientSafeWorkout(undefined), undefined);
  assert.equal(clientSafeExercise({ id: 'x', library_exercise: null }).library_exercise, null);
  assert.deepEqual(clientSafeProgramAssignment({ id: 'a', program: null }).exercise_loads, []);
});

test('withAuthor attaches a minimal publisher or null', () => {
  const coaches = new Map([['c1', { id: 'c1', name: 'Coach A', email: 'a@x', phone: '1' }]]);
  assert.deepEqual(withAuthor({ id: 'r', created_by: 'c1' }, coaches).author, { id: 'c1', name: 'Coach A' });
  assert.equal(withAuthor({ id: 'r', created_by: null }, coaches).author, null);
  assert.equal(withAuthor({ id: 'r', created_by: 'gone' }, coaches).author, null);
});

test('filterByAuthor keeps variations with their roots without pulling in siblings', () => {
  const rows = [
    { id: 'rootA', created_by: 'a', variation_of: null },
    { id: 'varA-by-b', created_by: 'b', variation_of: 'rootA' },
    { id: 'varA-by-a', created_by: 'a', variation_of: 'rootA' },
    { id: 'rootB', created_by: 'b', variation_of: null },
    { id: 'varB-by-a', created_by: 'a', variation_of: 'rootB' },
    { id: 'varB-by-b', created_by: 'b', variation_of: 'rootB' },
    { id: 'legacy', created_by: null, variation_of: null },
  ];
  const ids = (list) => list.map((r) => r.id).sort();
  const user = { coach: { id: 'a' } };
  // Coach a: matching root keeps ALL its variations; matching variation keeps only itself + root.
  assert.deepEqual(ids(filterByAuthor(rows, 'a', user)), ['rootA', 'rootB', 'varA-by-a', 'varA-by-b', 'varB-by-a']);
  assert.deepEqual(ids(filterByAuthor(rows, 'me', user)), ids(filterByAuthor(rows, 'a', user)));
  // Coach b owns rootB (so keeps all of rootB's variations) and only varA-by-b under rootA.
  const forB = ids(filterByAuthor(rows, 'b', user));
  assert.ok(forB.includes('varB-by-a'), 'a matching root keeps every variation');
  assert.ok(forB.includes('rootA') && forB.includes('varA-by-b'), 'a matching variation keeps its root');
  assert.equal(forB.includes('varA-by-a'), false, 'but not its non-matching siblings');
  assert.deepEqual(ids(filterByAuthor(rows, undefined, user)), ids(rows), 'no filter returns everything');
  assert.equal(filterByAuthor(rows, 'a', user).some((r) => r.id === 'legacy'), false, 'unattributed templates only in the unfiltered view');
  assert.deepEqual(filterByAuthor(rows, 'nobody', user), []);
});
