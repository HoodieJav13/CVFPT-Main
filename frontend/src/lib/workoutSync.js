import { tracks, trackingType, performedMetrics } from './workoutMetrics.js';
/**
 * Pure reconciliation rules for the workout outbox and tracker
 * (docs/offline-workout-completion.md). No app imports, so the rules are
 * unit-tested directly from backend/test/workout-sync.test.js.
 */

// Fields the client edits on a set. Everything else on a set row is
// server-owned (id, timestamps, set_number, origin).
const CLIENT_SET_FIELDS = ['status', 'actual_load_value', 'actual_load_unit', 'actual_reps', 'actual_rpe', 'actual_duration_value', 'actual_duration_unit', 'actual_distance_value', 'actual_distance_unit'];

/**
 * A queued "add set" landed. The server row carries server defaults, but
 * the optimistic row may already hold the client's later edits (typed
 * while offline). Take the server's identity and keep the client's values;
 * the queued writes that carry those values are still on their way.
 */
export function reconcileAddedSet(optimisticSet, serverSet) {
  if (!optimisticSet) return serverSet;
  const kept = {};
  CLIENT_SET_FIELDS.forEach((field) => {
    if (field in optimisticSet) kept[field] = optimisticSet[field];
  });
  return { ...serverSet, ...kept };
}

/** Point queued writes that targeted a pending set at its real id. */
export function rewritePendingSetId(operation, pendingId, realId) {
  if (operation.setId !== pendingId) return operation;
  return { ...operation, setId: realId, url: operation.url.replace(pendingId, realId) };
}

/**
 * Once a finish is queued, the log is sealed: the server rejects any write
 * that lands after the completion, so nothing but the completion itself
 * may join the queue.
 */
export function isWriteBlocked(queue, operation) {
  if (operation.kind === 'complete') return false;
  return queue.some((queued) => queued.kind === 'complete');
}

function isBlank(value) {
  return value === '' || value === null || value === undefined;
}

/**
 * "Same as last time": fill only fields that are blank in `sets` — which
 * must be the CURRENT sets, read after any history request resolves, so
 * values typed while it loaded are kept. Returns one PATCH body per set
 * that changed.
 */
export function lastTimeFills(sets, occurrence, exercise = {}) {
  if (!occurrence || trackingType(occurrence) !== trackingType(exercise)) return [];
  const bySetNumber = new Map((occurrence.sets || []).map((row) => [row.set_number, row]));
  const fills = [];
  (sets || []).forEach((set) => {
    const last = bySetNumber.get(set.set_number);
    if (!last) return;
    const fillLoad = isBlank(set.actual_load_value) && last.actual_load_value != null;
    const fillReps = isBlank(set.actual_reps) && last.actual_reps != null;
    const fillRpe = isBlank(set.actual_rpe) && last.actual_rpe != null;
    const metrics = performedMetrics(set, exercise);
    let fillMetric = false;
    for (const metric of ['duration', 'distance']) {
      const field = `actual_${metric}`;
      if (tracks(exercise, metric) && isBlank(set[`${field}_value`]) && last[`${field}_value`] != null) {
        metrics[`${field}_value`] = last[`${field}_value`];
        metrics[`${field}_unit`] = last[`${field}_unit`];
        fillMetric = true;
      }
    }
    if (!fillLoad && !fillReps && !fillRpe && !fillMetric) return;
    const loadValue = fillLoad ? last.actual_load_value : set.actual_load_value;
    fills.push({
      setId: set.id,
      data: {
        ...metrics,
        actual_load_value: isBlank(loadValue) ? null : Number(loadValue),
        actual_load_unit: isBlank(loadValue) ? null : ((fillLoad ? last.actual_load_unit : set.actual_load_unit) || 'lb'),
        actual_reps: fillReps ? last.actual_reps : (isBlank(set.actual_reps) ? null : Number(set.actual_reps)),
        actual_rpe: fillRpe ? last.actual_rpe : (isBlank(set.actual_rpe) ? null : Number(set.actual_rpe)),
        status: set.status,
      },
    });
  });
  return fills;
}
