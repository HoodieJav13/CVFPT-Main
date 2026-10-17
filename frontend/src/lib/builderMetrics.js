import { METRIC_UNITS, trackingType, tracks } from './workoutMetrics.js';
export function convertTarget(value, from, to, metric) {
  const number = Number(value);
  const units = METRIC_UNITS[metric];
  if (value === '' || value == null || !Number.isFinite(number) || number <= 0 || !units?.[from] || !units?.[to]) return null;
  const converted = number * units[from] / units[to];
  if (!Number.isFinite(converted) || converted <= 0) return null;
  // Round down rather than up so a valid maximum target stays within its limit.
  const scale = 10 ** (11 - Math.floor(Math.log10(converted)));
  if (!Number.isFinite(scale) || scale === 0) return converted;
  return Math.floor(converted * scale) / scale;
}
export function exerciseSummary(exercise) {
  const targets = ['duration', 'distance'].filter((metric) => tracks(exercise, metric) && exercise[`${metric}_value`] !== '' && exercise[`${metric}_value`] != null)
    .map((metric) => `${exercise[`${metric}_value`]} ${exercise[`${metric}_unit`] || (metric === 'duration' ? 's' : 'm')}`);
  const target = trackingType(exercise) === 'reps_weight' ? exercise.reps : targets.join(' + ');
  return target ? `${exercise.sets ? `${exercise.sets} × ` : ''}${target}${trackingType(exercise) === 'reps_weight' ? ' reps' : ''}`
    : exercise.sets ? `${exercise.sets} sets` : '';
}
