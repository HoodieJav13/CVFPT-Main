// Active-workout guidance (P1): the next unfinished set, the compact outline,
// and the explicit "repeat previous performed set" rule. Pure functions over
// the tracker's log shape, so the rules are unit-tested without a browser.
import { supersetBlocks, exerciseMarkers, groupKindLabel, nextExercise } from './supersets.js';
import { performedSet, trackingType, tracks } from './workoutMetrics.js';

const isDone = (set) => set.status === 'completed';

// The one set to work on next. Inside a superset/giant set the round order
// comes from nextExercise (fewest completed first, earliest on a tie), so
// after A1 set 1 the next work is A2 set 1, then A1 set 2. Within the chosen
// exercise it is the first set that is not completed. Null when all done.
export function nextWork(exercises) {
  const exercise = nextExercise(exercises || []);
  if (!exercise) return null;
  const set = (exercise.sets || []).find((row) => !isDone(row));
  return set ? { exerciseId: exercise.id, setId: set.id, setNumber: set.set_number, exerciseName: exercise.exercise_name } : null;
}

// Compact outline: exercise names in coach order, grouped by superset/giant
// set. Deliberately no sets, reps or loads.
export function outlineBlocks(exercises) {
  const list = exercises || [];
  const markers = exerciseMarkers(list);
  const next = nextWork(list);
  const grouped = list.some((exercise) => exercise.superset_group);
  return supersetBlocks(list).map((block, blockIndex) => ({
    key: `${block.start}-${block.end}`,
    kind: block.kind,
    label: block.kind === 'single' ? null : `${groupKindLabel(block.kind)} ${markers[block.start]?.replace(/\d+$/, '') || blockIndex + 1}`,
    items: block.items.map(({ exercise, index }) => {
      const sets = exercise.sets || [];
      const status = sets.length && sets.every(isDone) ? 'done' : next?.exerciseId === exercise.id ? 'next' : 'open';
      return { id: exercise.id, name: exercise.exercise_name, marker: grouped ? markers[index] : String(index + 1), status };
    }),
  }));
}

const blank = (value) => value === '' || value === null || value === undefined;
const sameNumber = (a, b) => (blank(a) && blank(b)) || (!blank(a) && !blank(b) && Number(a) === Number(b));

// True when the set still holds only the untouched prescribed prefill: no
// performed values typed or saved, and the load still equals the coach's
// prescribed load. Anything else is the user's own entry and is never
// replaced silently.
export function isUntouchedPrefill(exercise, set) {
  if (Number.isInteger(set.revision) && set.revision > 0) return false;
  if (!blank(set.actual_reps) || !blank(set.actual_rpe)) return false;
  for (const metric of ['duration', 'distance']) if (!blank(set[`actual_${metric}_value`])) return false;
  if (!sameNumber(set.actual_load_value, exercise.prescribed_load_value)) return false;
  if (!blank(set.actual_load_value) && (set.actual_load_unit || 'lb') !== (exercise.prescribed_load_unit || 'lb')) return false;
  return true;
}

function sourceHasActuals(exercise, source) {
  const type = trackingType(exercise);
  if (type === 'reps_weight') return !blank(source.actual_reps);
  return ['duration', 'distance'].every((metric) => !tracks(exercise, metric) || !blank(source[`actual_${metric}_value`]));
}

function describe(exercise, source) {
  const parts = [];
  if (!blank(source.actual_load_value)) parts.push(`${Number(source.actual_load_value)} ${source.actual_load_unit || 'lb'}`);
  if (trackingType(exercise) === 'reps_weight' && !blank(source.actual_reps)) parts.push(`${source.actual_reps} reps`);
  for (const metric of ['duration', 'distance']) {
    if (tracks(exercise, metric) && !blank(source[`actual_${metric}_value`])) parts.push(`${source[`actual_${metric}_value`]} ${source[`actual_${metric}_unit`] || ''}`.trim());
  }
  return parts.join(' × ');
}

// The explicit repeat action for `set`: record it as performed with the
// previous completed set's actuals (same exercise, so the same tracking mode
// and units). RPE is a per-set judgement and is not copied. Returns
// { available, reason, source, label, payload }.
export function repeatPlan(exercise, set, { drafting = false, conflicts = [] } = {}) {
  if (!set || isDone(set)) return { available: false, reason: null };
  const source = [...(exercise.sets || [])]
    .filter((row) => isDone(row) && row.set_number < set.set_number)
    .sort((a, b) => b.set_number - a.set_number)[0];
  if (!source) return { available: false, reason: null };
  const unavailable = (reason) => ({ available: false, reason, source });
  if ((conflicts || []).some((row) => row.workout_log_set_id === set.id && row.status === 'open')) {
    return unavailable('Repeat unavailable: this set has a disagreement waiting for your coach.');
  }
  if (drafting) return { ...unavailable('Repeat unavailable: finish or clear what you are typing in this set first.'), quiet: true };
  if (!isUntouchedPrefill(exercise, set)) return { ...unavailable('Repeat unavailable: this set already has values you entered.'), quiet: true };
  if (!sourceHasActuals(exercise, source)) return unavailable(`Repeat unavailable: set ${source.set_number} has no recorded ${trackingType(exercise) === 'reps_weight' ? 'reps' : 'result'}.`);
  const values = {
    actual_load_value: source.actual_load_value ?? null,
    actual_load_unit: blank(source.actual_load_value) ? null : (source.actual_load_unit || 'lb'),
    actual_reps: trackingType(exercise) === 'reps_weight' ? source.actual_reps : null,
    actual_rpe: null,
  };
  for (const metric of ['duration', 'distance']) {
    if (!tracks(exercise, metric)) continue;
    values[`actual_${metric}_value`] = source[`actual_${metric}_value`] ?? null;
    values[`actual_${metric}_unit`] = source[`actual_${metric}_unit`] ?? null;
  }
  let payload;
  try {
    payload = performedSet({ ...set, ...values, status: 'completed' }, exercise);
  } catch {
    return unavailable(`Repeat unavailable: set ${source.set_number}'s values could not be reused.`);
  }
  const text = describe(exercise, source);
  return { available: true, reason: null, source, values, payload, label: `Same as set ${source.set_number}: ${text}` };
}
