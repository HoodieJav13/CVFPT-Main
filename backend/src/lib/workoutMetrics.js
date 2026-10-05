// Duplicated as frontend/src/lib/workoutMetrics.js: separate Vercel roots.
const TRACKING_TYPES = ['reps_weight', 'duration', 'distance', 'duration_distance'];
const METRIC_UNITS = { duration: { s: 1, min: 60 }, distance: { m: 1, km: 1000, mi: 1609.344, yd: 0.9144 } };
function trackingType(exercise = {}) { return exercise.tracking_type ?? 'reps_weight'; }
function tracks(exercise, metric) { const type = trackingType(exercise); return type === metric || type === 'duration_distance'; }
// Match JSON decimal values to Postgres numeric arithmetic at unit boundaries.
function withinMetricLimit(value, factor, max) {
  const decimal = (number) => {
    const [mantissa, exponent = '0'] = String(number).split('e');
    const fraction = mantissa.split('.')[1]?.length || 0;
    return { integer: BigInt(mantissa.replace('.', '')), exponent: Number(exponent) - fraction };
  };
  const left = decimal(value), right = decimal(factor);
  const product = left.integer * right.integer;
  const exponent = left.exponent + right.exponent;
  return exponent >= 0 ? product * 10n ** BigInt(exponent) <= BigInt(max)
    : product <= BigInt(max) * 10n ** BigInt(-exponent);
}
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
  if (typeof number !== 'number' || !Number.isFinite(number) || number <= 0 || !factor || !withinMetricLimit(number, factor, max)) {
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
function performedSet(set, exercise = {}) {
  const blank = (value) => value === '' || value == null;
  const payload = {
    ...performedMetrics(set, exercise),
    actual_load_value: blank(set.actual_load_value) ? null : Number(set.actual_load_value),
    actual_load_unit: blank(set.actual_load_value) ? null : (set.actual_load_unit || 'lb'),
    actual_reps: blank(set.actual_reps) ? null : Number(set.actual_reps),
    actual_rpe: blank(set.actual_rpe) ? null : Number(set.actual_rpe),
    status: set.status,
  };
  const invalid = (message) => { throw Object.assign(new Error(message), { status: 400 }); };
  if (payload.actual_load_value != null && (!Number.isFinite(payload.actual_load_value) || payload.actual_load_value < 0 || !['lb', 'kg'].includes(payload.actual_load_unit))) invalid('Enter a valid weight and unit');
  if (payload.actual_reps != null && (!Number.isInteger(payload.actual_reps) || payload.actual_reps < 0)) invalid('Reps must be a nonnegative whole number or null');
  if (payload.actual_rpe != null && (!Number.isFinite(payload.actual_rpe) || payload.actual_rpe < 1 || payload.actual_rpe > 10 || !Number.isInteger(payload.actual_rpe * 2))) invalid('RPE must be 1 through 10 in 0.5 increments or null');
  if (trackingType(exercise) !== 'reps_weight' && payload.actual_reps != null) invalid('Reps do not match the exercise tracking type');
  actualMetrics(payload, {}, exercise);
  return payload;
}
function trackingTargets(exercise = {}) {
  return ['duration', 'distance'].filter((metric) => tracks(exercise, metric) && exercise[`${metric}_value`] != null && exercise[`${metric}_value`] !== '')
    .map((metric) => `${metric === 'duration' ? 'Duration' : 'Distance'}: ${exercise[`${metric}_value`]} ${exercise[`${metric}_unit`]}`);
}
function setPrescription(exercise = {}) {
  return trackingType(exercise) === 'reps_weight' ? `${exercise.sets || '?'} x ${exercise.reps || '?'}` : `${exercise.sets || '?'} sets`;
}
module.exports = { TRACKING_TYPES, METRIC_UNITS, trackingType, tracks, metricPair, normalizeTracking, actualMetrics, performedMetrics, performedSet, trackingTargets, setPrescription };
