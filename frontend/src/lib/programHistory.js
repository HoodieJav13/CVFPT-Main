// Coach-only program prescription snapshots. Never include performed/completed logs.
const PROGRAM_FIELDS = ['name', 'description', 'frequency_days'];
const DAY_FIELDS = ['day_number', 'notes'];
const WORKOUT_FIELDS = ['name', 'description', 'goal'];
const EXERCISE_FIELDS = ['name', 'exercise_library_id', 'sets', 'reps', 'rest', 'rest_seconds', 'tempo', 'target_rpe', 'tracking_type', 'duration_value', 'duration_unit', 'distance_value', 'distance_unit', 'default_load_value', 'default_load_unit', 'notes', 'client_notes', 'coach_notes', 'video_url', 'video_link_mode', 'superset_group'];
const copy = (value) => structuredClone(value);
const pick = (row, fields) => Object.fromEntries(fields.map((key) => [key, row?.[key] ?? null]));
export function snapshotProgram(program) {
  if (!program) return null;
  return { id: program.id, ...pick(program, PROGRAM_FIELDS), days: (program.days || []).map((day) => ({
    id: day.id, ...pick(day, DAY_FIELDS), workout: day.workout ? {
      id: day.workout.id, ...pick(day.workout, WORKOUT_FIELDS),
      exercises: (day.workout.exercises || []).map((row) => ({ id: row.id, ...pick({ ...row, name: row.custom_name || row.library_exercise?.name || row.name || 'Exercise' }, EXERCISE_FIELDS) })),
    } : null,
  })) };
}
export function diffProgramRevisions(before, after) {
  if (!before || !after || before.id !== after.id) return null;
  const changes = [];
  const fields = (a, b, keys, path) => keys.forEach((field) => {
    if (JSON.stringify(a?.[field] ?? null) !== JSON.stringify(b?.[field] ?? null)) changes.push({ kind: 'changed', path, field, before: a?.[field] ?? null, after: b?.[field] ?? null });
  });
  const rows = (a, b, path, label, compare) => {
    const left = new Map(a.map((row) => [row.id, row]));
    const right = new Map(b.map((row) => [row.id, row]));
    a.forEach((row) => { if (!right.has(row.id)) changes.push({ kind: 'removed', path, field: label(row), before: row, after: null }); });
    b.forEach((row) => { if (!left.has(row.id)) changes.push({ kind: 'added', path, field: label(row), before: null, after: row }); });
    const commonA = a.filter((row) => right.has(row.id)).map((row) => row.id);
    const commonB = b.filter((row) => left.has(row.id)).map((row) => row.id);
    if (JSON.stringify(commonA) !== JSON.stringify(commonB)) changes.push({ kind: 'reordered', path, field: 'order', before: a.map(label), after: b.map(label) });
    b.forEach((row) => { if (left.has(row.id)) compare(left.get(row.id), row); });
  };
  fields(before, after, PROGRAM_FIELDS, 'Program');
  rows(before.days || [], after.days || [], 'Days', (d) => d.workout?.name || `Day ${d.day_number}`, (a, b) => {
    const path = `Day ${b.day_number} · ${b.workout?.name || 'Workout'}`;
    fields(a, b, DAY_FIELDS, path);
    if (a.workout?.id !== b.workout?.id) changes.push({ kind:'changed', path, field:'workout', before:a.workout, after:b.workout });
    else {
      fields(a.workout, b.workout, WORKOUT_FIELDS, path);
      rows(a.workout?.exercises || [], b.workout?.exercises || [], `${path} · Exercises`, (e) => e.name, (x, y) => fields(x, y, EXERCISE_FIELDS, `${path} · ${y.name}`));
    }
  });
  return changes;
}
// Fixture-only: held in memory, reset on reload. Not connected to the real API.
export function createPreviewHistory(seed = {}) {
  const entries = copy(seed);
  return {
    read: (programId) => copy(entries[programId] || []),
    capture(before, after, author, recordedAt, source) {
      const snapshot = snapshotProgram(after);
      if (!snapshot) return;
      const previous = snapshotProgram(before);
      if (previous && !diffProgramRevisions(previous, snapshot)?.length) return;
      const list = entries[after.id] ||= [];
      if (!list.length && previous) list.push({ id: `${after.id}:observed`, snapshot: previous, author: null, recorded_at: null, source: 'First observed snapshot · original change metadata unavailable' });
      // A gap cannot be presented as one known save. Keep the newly observed baseline.
      if (list.length && previous && diffProgramRevisions(list.at(-1).snapshot, previous)?.length) list.push({ id: `${after.id}:${list.length}`, snapshot: previous, author: null, recorded_at: null, source: 'Observed snapshot · intervening changes unavailable' });
      list.push({ id: `${after.id}:${list.length}`, snapshot, author: author ? { id: author.id, name: author.name || null } : null, recorded_at: recordedAt || null, source });
    },
  };
}
