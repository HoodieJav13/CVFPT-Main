// Pure helpers for the shared training library (templates, client instances,
// coach attribution, client-facing serializers). No I/O so they are unit-testable.

function pick(source, keys) {
  const out = {};
  if (!source) return out;
  for (const key of keys) if (key in source) out[key] = source[key];
  return out;
}

// Rows written before the template/instance split have no is_template column
// value in fixtures; the migration defaults every existing row to a template.
function isTemplate(row) {
  return row?.is_template !== false;
}

// ----- Client-facing serializers (explicit allowlists) -----
// Clients must never receive publisher attribution, provenance/variation
// links, the hidden flag, coach-only notes, or other clients' assignments.
// These allowlists intentionally list existing columns one by one, so a new
// column added to a table is private by default until it is added here.
const CLIENT_PROGRAM_FIELDS = ['id', 'name', 'description', 'frequency_days', 'archived', 'created_at'];
const CLIENT_WORKOUT_FIELDS = ['id', 'name', 'description', 'goal', 'archived', 'created_at', 'updated_at'];
const CLIENT_DAY_FIELDS = ['id', 'program_id', 'day_number', 'workout_id', 'notes', 'archived', 'created_at'];
const CLIENT_EXERCISE_FIELDS = [
  'id', 'workout_id', 'exercise_library_id', 'custom_name', 'sets', 'reps', 'rest', 'rest_seconds',
  'tempo', 'target_rpe', 'default_load_value', 'default_load_unit', 'notes', 'client_notes',
  'video_url', 'position', 'archived', 'created_at',
];
const CLIENT_LIBRARY_EXERCISE_FIELDS = [
  'id', 'name', 'category', 'equipment', 'primary_muscle', 'secondary_muscles', 'video_url',
];
const CLIENT_PROGRAM_ASSIGNMENT_FIELDS = ['id', 'program_id', 'client_id', 'notes', 'archived', 'created_at'];
const CLIENT_WORKOUT_ASSIGNMENT_FIELDS = [
  'id', 'client_id', 'workout_id', 'assignment_mode', 'assigned_for', 'notes', 'archived', 'created_at',
];

function clientSafeExercise(exercise) {
  if (!exercise) return exercise;
  const safe = pick(exercise, CLIENT_EXERCISE_FIELDS);
  if ('library_exercise' in exercise) {
    safe.library_exercise = exercise.library_exercise
      ? pick(exercise.library_exercise, CLIENT_LIBRARY_EXERCISE_FIELDS)
      : null;
  }
  return safe;
}

function clientSafeWorkout(workout) {
  if (!workout) return workout;
  return {
    ...pick(workout, CLIENT_WORKOUT_FIELDS),
    exercises: (workout.exercises || []).map(clientSafeExercise),
    exercise_count: workout.exercise_count,
  };
}

function clientSafeProgram(program) {
  if (!program) return program;
  return {
    ...pick(program, CLIENT_PROGRAM_FIELDS),
    days: (program.days || []).map((day) => ({
      ...pick(day, CLIENT_DAY_FIELDS),
      workout: clientSafeWorkout(day.workout),
    })),
  };
}

function clientSafeProgramAssignment(assignment) {
  return {
    ...pick(assignment, CLIENT_PROGRAM_ASSIGNMENT_FIELDS),
    exercise_loads: assignment.exercise_loads || [],
    program: clientSafeProgram(assignment.program),
  };
}

function clientSafeWorkoutAssignment(assignment) {
  return {
    ...pick(assignment, CLIENT_WORKOUT_ASSIGNMENT_FIELDS),
    exercise_loads: assignment.exercise_loads || [],
    workout: clientSafeWorkout(assignment.workout),
  };
}

// ----- Coach-facing template listings -----
// Adds the publisher as { id, name } (or null) from a coaches lookup.
function withAuthor(row, coachesById) {
  const coach = row.created_by ? coachesById.get(row.created_by) : null;
  return { ...row, author: coach ? { id: coach.id, name: coach.name } : null };
}

// ?author=me|<coach id>. Variations follow their root: a match on a root keeps
// its children, and a matching variation keeps its root so it nests correctly.
function filterByAuthor(rows, author, user) {
  if (!author) return rows;
  const wanted = author === 'me' ? user?.coach?.id : author;
  if (!wanted) return rows;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const matchedRoots = new Set();
  const keep = new Set();
  for (const row of rows) {
    if (row.created_by !== wanted) continue;
    keep.add(row.id);
    if (!row.variation_of) matchedRoots.add(row.id);
    // A matching variation keeps its root as context, but not its siblings.
    else if (byId.has(row.variation_of)) keep.add(row.variation_of);
  }
  for (const row of rows) {
    if (row.variation_of && matchedRoots.has(row.variation_of)) keep.add(row.id);
  }
  return rows.filter((row) => keep.has(row.id));
}

module.exports = {
  isTemplate,
  clientSafeExercise,
  clientSafeWorkout,
  clientSafeProgram,
  clientSafeProgramAssignment,
  clientSafeWorkoutAssignment,
  withAuthor,
  filterByAuthor,
};
