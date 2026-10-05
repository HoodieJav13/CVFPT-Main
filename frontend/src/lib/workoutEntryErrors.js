import { performedSet, tracks, trackingType } from './workoutMetrics.js';

// Ask the existing persistence validator about each field independently so
// simultaneous errors can be associated with their controls without duplicating
// numeric limits, tracking rules or unit conversion arithmetic.
export function workoutEntryErrors(set, exercise) {
  const fields = ['actual_load_value', 'actual_rpe'];
  if (trackingType(exercise) === 'reps_weight') fields.push('actual_reps');
  for (const metric of ['duration', 'distance']) if (tracks(exercise, metric)) fields.push(`actual_${metric}_value`);
  const errors = {};
  for (const field of fields) {
    const isolated = { ...set, actual_load_value: null, actual_reps: null, actual_rpe: null, actual_duration_value: null, actual_distance_value: null, [field]: set[field] };
    try { performedSet(isolated, exercise); }
    catch (error) { errors[field] = error.message.replace('or null', 'or leave blank'); }
  }
  return errors;
}
