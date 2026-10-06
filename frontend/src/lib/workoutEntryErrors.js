import { performedSet, tracks, trackingType } from './workoutMetrics.js';

// Presentation only: persistence remains the single source of validation rules.
const guidance = {
  'Enter a valid weight and unit': 'Use weight 0 or more with lb or kg, or leave blank.',
  'Reps must be a nonnegative whole number or null': 'Use a whole number of reps (0 or more), or leave blank.',
  'RPE must be 1 through 10 in 0.5 increments or null': 'Use RPE 1–10 in 0.5 steps, or leave blank.',
  'Duration must be positive, in s or min, up to 24 hours': 'Use a positive duration in s or min, up to 24 hours, or leave blank.',
  'Distance must be positive, in m, km, mi or yd, up to 1,000 km': 'Use a positive distance in m, km, mi or yd, up to 1,000 km, or leave blank.',
};

export function workoutEntryErrorMessage(error) {
  return guidance[error.message] || error.message.replace('or null', 'or leave blank');
}

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
    catch (error) { errors[field] = workoutEntryErrorMessage(error); }
  }
  return errors;
}
