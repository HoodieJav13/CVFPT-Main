// Duplicated as frontend/src/lib/workoutMetrics.js: separate Vercel roots.
const TRACKING_TYPES = ['reps_weight', 'duration', 'distance', 'duration_distance'];
const METRIC_UNITS = { duration: { s: 1, min: 60 }, distance: { m: 1, km: 1000, mi: 1609.344, yd: 0.9144 } };
function trackingType(exercise = {}) { return exercise.tracking_type ?? 'reps_weight'; }
function tracks(exercise, metric) { const type = trackingType(exercise); return type === metric || type === 'duration_distance'; }
function metricPair(value, unit, metric, { coerce = false } = {}) {
  const blank = value === null || value === undefined || value === '';
  if (blank) {
    if (unit !== null && unit !== undefined && unit !== '') throw Object.assign(new Error(`${metric} unit needs a value`), { status: 400 });
    return { value: null, unit: null };
  }
  const number = coerce && typeof value === 'string' && value.trim() ? Number(value) : value;
  const units = METRIC_UNITS[metric];
  const factor = units && Object.hasOwn(units, unit) ? units[unit] : undefined;
  const max = metric === 'duration' ? 86400 : 1000000;
  if (typeof number !== 'number' || !Number.isFinite(number) || number <= 0 || !factor || number * factor > max) {
    throw Object.assign(new Error(metric === 'duration' ? 'Duration must be positive, in s or min, up to 24 hours' : 'Distance must be positive, in m, km, mi or yd, up to 1,000 km'), { status: 400 });
  }
  return { value: number, unit };
}
function normalizeTracking(exercise = {}) {
  const type = trackingType(exercise);
  if (!TRACKING_TYPES.includes(type)) throw Object.assign(new Error('Choose a valid exercise tracking type'), { status: 400 });
  const result = { tracking_type: type };
  for (const metric of ['duration', 'distance']) {
    const value = exercise[`${metric}_value`];
    const pair = metricPair(value, value === '' || value == null ? null : exercise[`${metric}_unit`], metric, { coerce: true });
    if (!tracks(exercise, metric) && pair.value != null) throw Object.assign(new Error(`${metric} does not match the exercise tracking type`), { status: 400 });
    result[`${metric}_value`] = pair.value;
    result[`${metric}_unit`] = pair.unit;
  }
  return result;
}
function actualMetrics(body, set, exercise = {}) {
  const result = {};
  for (const metric of ['duration', 'distance']) {
    const field = `actual_${metric}`;
    const value = Object.hasOwn(body, `${field}_value`) ? body[`${field}_value`] : set[`${field}_value`];
    const unit = Object.hasOwn(body, `${field}_unit`) ? body[`${field}_unit`] : set[`${field}_unit`];
    const pair = metricPair(value, unit, metric);
    if (!tracks(exercise, metric) && pair.value != null) throw Object.assign(new Error(`${metric} does not match the exercise tracking type`), { status: 400 });
    // Legacy helper callers retain their exact existing payload; migrated rows
    // and any request that edits a metric always carry both fields.
    if (tracks(exercise, metric) || `${field}_value` in body || `${field}_unit` in body || `${field}_value` in set) {
      result[`${field}_value`] = pair.value; result[`${field}_unit`] = pair.unit;
    }
  }
  return result;
}
function performedMetrics(set, exercise = {}) {
  const result = {};
  for (const metric of ['duration', 'distance']) {
    if (!tracks(exercise, metric)) continue;
    const field = `actual_${metric}`;
    const value = set[`${field}_value`];
    result[`${field}_value`] = value === '' || value == null ? null : Number(value);
    result[`${field}_unit`] = value === '' || value == null ? null : (set[`${field}_unit`] || exercise[`prescribed_${metric}_unit`] || (metric === 'duration' ? 's' : 'm'));
  }
  return result;
}
function trackingTargets(exercise = {}) {
  return ['duration', 'distance'].filter((metric) => tracks(exercise, metric) && exercise[`${metric}_value`] != null && exercise[`${metric}_value`] !== '')
    .map((metric) => `${metric === 'duration' ? 'Duration' : 'Distance'}: ${exercise[`${metric}_value`]} ${exercise[`${metric}_unit`]}`);
}
function setPrescription(exercise = {}) {
  return trackingType(exercise) === 'reps_weight' ? `${exercise.sets || '?'} x ${exercise.reps || '?'}` : `${exercise.sets || '?'} sets`;
}
module.exports = { TRACKING_TYPES, METRIC_UNITS, trackingType, tracks, metricPair, normalizeTracking, actualMetrics, performedMetrics, trackingTargets, setPrescription };
