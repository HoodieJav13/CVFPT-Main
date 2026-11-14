import { tracks, trackingType, performedMetrics } from './workoutMetrics.js';
// An old backend can return 200 while ignoring new fields. Never drop those edits.
export function metricWriteAcknowledged(request, response = {}) {
  return ['actual_duration_value', 'actual_duration_unit', 'actual_distance_value', 'actual_distance_unit']
    .every((field) => !Object.hasOwn(request, field) || (Object.hasOwn(response, field) && response[field] === request[field]));
}
// The server row's last write is exactly this queued set event, and the row
// holds the metrics it asked for (the same protection as a sent write:
// an older backend can stamp the event id yet ignore duration/distance).
// LOOK-A-INTEGRATION-REVIEW residual case 1; LOOK-A-OUTBOX-ACK-REVIEW.md.
export function deliveredBy(row, operation) {
  return operation?.kind === 'set' && Boolean(operation.data?.event_id) && row?.last_event_id === operation.data.event_id
    && metricWriteAcknowledged(operation.data, row);
}
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

/**
 * Bounded refresh (L12): adopt the server copy of the log, except for sets the
 * person is still typing into. A draft keeps its typed values AND the revision
 * it was typed against, so saving it later is checked against what the other
 * person changed meanwhile (both values are kept if they differ).
 */
/**
 * Cross-device Undo (2026-11-12): what a queued set write may change on the
 * device's copy. A declared value_origin is applied only to a row that already
 * has one (a server with the origin schema); on an old server's row it would
 * fake that schema, so it is left out.
 */
export function optimisticSetData(set, data = {}) {
  if (!Object.hasOwn(data, 'value_origin') || Object.hasOwn(set || {}, 'value_origin')) return data;
  const rest = { ...data };
  delete rest.value_origin;
  return rest;
}

/**
 * Server-owned fields adopted from a set write's acknowledgement (origin and
 * updated_at only when the server sends them). updated_at keeps the row's stamp
 * in step with the marker its acknowledgement binds (Ultra F1, 2026-11-12).
 */
export function ackedSetFields(response = {}) {
  const fields = { revision: response.revision, last_actor_role: response.last_actor_role, completed_plan_revision: response.completed_plan_revision };
  if (Object.hasOwn(response, 'value_origin')) fields.value_origin = response.value_origin;
  if (typeof response.updated_at === 'string' && response.updated_at) fields.updated_at = response.updated_at;
  return fields;
}

/**
 * The screen row after a set write's reply. An applied reply describes this
 * write, so the server-owned fields are adopted (the values on screen stay). A
 * conflict or a replay does not (F3, 2026-11-12): a replay carries the
 * server's CURRENT row, which may hold another device's newer value. Adopting
 * its revision while keeping this screen's values would let a later write of
 * those values claim the newer revision, so the row stays exactly as it is,
 * revision included, until a refresh shows the server's values.
 */
export function ackedSetRow(set, response = {}) {
  const outcome = response?.event?.outcome;
  if (outcome === 'conflict' || outcome === 'replayed') return set;
  return { ...set, ...ackedSetFields(response) };
}

// A draft row is the screen's copy of a set the person is typing into. Only
// the fields they actually edited are theirs (independent review of f284a1e6,
// 2026-11-12): the rest of the row may be older than the server's, and the
// server applies a same-actor write whatever its base revision, so a refresh
// must not carry untouched stale values forward into the next save.
const DRAFT_PAIRS = {
  actual_load_value: 'actual_load_unit', actual_load_unit: 'actual_load_value',
  actual_duration_value: 'actual_duration_unit', actual_duration_unit: 'actual_duration_value',
  actual_distance_value: 'actual_distance_unit', actual_distance_unit: 'actual_distance_value',
};
const blankValue = (value) => value === null || value === undefined || value === '';
function sameValue(left, right) {
  if (blankValue(left) || blankValue(right)) return blankValue(left) && blankValue(right);
  const a = Number(left);
  const b = Number(right);
  if (typeof left !== 'boolean' && typeof right !== 'boolean' && Number.isFinite(a) && Number.isFinite(b)) return a === b;
  return String(left) === String(right);
}

// Record which field the person is about to change on a set, with its value
// from before their FIRST edit (a value and its unit count as one edit).
export function noteDraftEdit(edits, set, field) {
  const next = { ...(edits || {}) };
  for (const key of [field, DRAFT_PAIRS[field]].filter(Boolean)) {
    if (!Object.hasOwn(next, key)) next[key] = set?.[key] ?? null;
  }
  return next;
}

// Draft fields the server also changed to something else (neither the value
// before the edit nor the typed one): set id -> those fields. Nobody can know
// which one the person wants, so the screen asks.
export function draftCollisionsIn(localLog, serverLog, draftSetIds, draftEdits) {
  const found = new Map();
  if (!localLog || !serverLog || !draftSetIds?.size || !draftEdits?.size) return found;
  const localSets = new Map(localLog.exercises.flatMap((exercise) => exercise.sets.map((set) => [set.id, set])));
  for (const exercise of serverLog.exercises || []) {
    for (const set of exercise.sets || []) {
      const edits = draftSetIds.has(set.id) ? draftEdits.get(set.id) : null;
      const draft = localSets.get(set.id);
      if (!edits || !draft) continue;
      const fields = Object.keys(edits).filter((field) => !sameValue(set[field], edits[field]) && !sameValue(set[field], draft[field]));
      if (fields.length) found.set(set.id, fields);
    }
  }
  return found;
}

export function mergeRefresh(localLog, serverLog, draftSetIds, draftEdits) {
  if (!localLog || !draftSetIds?.size) return serverLog;
  const localSets = new Map(localLog.exercises.flatMap((exercise) => exercise.sets.map((set) => [set.id, set])));
  return {
    ...serverLog,
    exercises: serverLog.exercises.map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => {
        const draft = draftSetIds.has(set.id) ? localSets.get(set.id) : null;
        if (!draft) return set;
        const edits = draftEdits?.get(set.id);
        let kept;
        if (edits) {
          // The server's row and revision, plus only what the person typed.
          kept = { ...set };
          Object.keys(edits).forEach((field) => { kept[field] = draft[field]; });
        } else {
          // No record of the edited fields (earlier callers): the whole row, as before.
          kept = { ...set, revision: draft.revision ?? 0 };
          CLIENT_SET_FIELDS.forEach((field) => { kept[field] = draft[field]; });
        }
        // The typed values keep their own meaning too (when the server has origins).
        if (Object.hasOwn(set, 'value_origin') && Object.hasOwn(draft, 'value_origin')) kept.value_origin = draft.value_origin;
        return kept;
      }),
    })),
  };
}

/** Plain-language freshness for bounded refresh labels. */
export function freshnessLabel(lastCheckedAt, now = Date.now(), { online = true, everySeconds } = {}) {
  if (!lastCheckedAt) return online ? 'Not checked with the server yet' : 'Offline · not checked with the server yet';
  const seconds = Math.max(0, Math.round((now - lastCheckedAt) / 1000));
  const age = seconds < 60 ? `${seconds} s ago` : `${Math.round(seconds / 60)} min ago`;
  if (!online) return `Offline · last checked ${age}; showing this device's copy`;
  return everySeconds ? `Checked ${age} · refreshes every ${everySeconds} s` : `Checked ${age}`;
}

// ---------------------------------------------------------------------------
// Queued same-set writes after a replay (F5, independent review of fb1d7df2,
// 2026-11-13). A write queued before a replayed reply carries the whole screen
// row, which may be older than the server's, and the server applies a
// same-actor write whatever its base revision. Such writes are re-checked
// against the server's current row before they are sent.
const QUEUED_VALUE_FIELDS = CLIENT_SET_FIELDS.filter((field) => field !== 'status');

// The set row carried by a set-event reply (the replay reply is the current row), or null.
export function replyRow(data) {
  if (!data || typeof data !== 'object' || !Number.isInteger(data.revision) || !Object.hasOwn(data, 'actual_load_value')) return null;
  return data;
}

// Mark every queued write for this set to be re-checked before it is sent.
export function markRecheck(queue, setId) {
  return queue.map((operation) => ((operation.kind === 'set' || operation.kind === 'archive') && operation.setId === setId
    ? { ...operation, recheck: true } : operation));
}

// The next queue entry that may be sent: parked writes, and anything after
// them for the same set, wait; a queued Finish waits while anything is parked.
export function nextSendable(queue) {
  const waiting = new Set();
  for (const operation of queue) {
    if (operation.parked) { if (operation.setId) waiting.add(operation.setId); continue; }
    if (operation.setId && waiting.has(operation.setId)) continue;
    if (operation.kind === 'complete' && queue.some((queued) => queued.parked)) return null;
    return operation;
  }
  return null;
}

// Value edits only: the person changed these fields and not completion.
const valueOnlyEdits = (operation) => {
  const edits = operation.edits && typeof operation.edits === 'object' ? operation.edits : null;
  return edits && !Object.hasOwn(edits, 'status') ? edits : null;
};
function rebuilt(operation, row, takeServer) {
  const data = { ...operation.data };
  for (const field of CLIENT_SET_FIELDS) if (takeServer.has(field) && Object.hasOwn(data, field)) data[field] = row[field] ?? null;
  data.base_revision = row.revision;
  return data;
}
const serverDefaults = (operation, data) => {
  const edits = valueOnlyEdits(operation);
  // A value edit keeps only its edited fields; untouched fields and completion come from the server.
  return new Set(edits ? CLIENT_SET_FIELDS.filter((field) => !Object.hasOwn(edits, field) && Object.hasOwn(data, field)) : []);
};
const pick = (source, fields) => Object.fromEntries(fields.map((field) => [field, source?.[field] ?? null]));

/**
 * Decide a queued write against the server's current row:
 * - value edit: edited fields kept, the rest from the server; a same-field
 *   change elsewhere (server differs from both the pre-edit and the typed
 *   value) waits for an explicit choice;
 * - completion, Undo restore or unknown intent: sent unchanged when no value
 *   differs from the server, otherwise it waits for an explicit choice.
 * Never infers which values were meant.
 */
export function reconcileQueuedSet(operation, row) {
  if (operation.kind !== 'set') return { action: 'send', data: operation.data };
  const data = operation.data || {};
  const edits = valueOnlyEdits(operation);
  let fields;
  if (edits) {
    const colliding = QUEUED_VALUE_FIELDS.filter((field) => Object.hasOwn(edits, field) && Object.hasOwn(data, field)
      && !sameValue(row[field], edits[field]) && !sameValue(row[field], data[field]));
    fields = [...new Set(colliding.flatMap((field) => [field, DRAFT_PAIRS[field]].filter((key) => key && Object.hasOwn(edits, key))))];
  } else {
    fields = QUEUED_VALUE_FIELDS.filter((field) => Object.hasOwn(data, field) && !sameValue(row[field], data[field]));
  }
  if (fields.length) return { action: 'choose', fields, saved: pick(row, fields), yours: pick(data, fields) };
  return { action: 'send', data: rebuilt(operation, row, serverDefaults(operation, data)) };
}

// The person's explicit answer: 'mine' sends the queued values for the shown
// fields; 'saved' takes the server's; nothing left to change drops the write.
export function resolveQueuedChoice(operation, row, fields, choice) {
  const data = operation.data || {};
  const take = serverDefaults(operation, data);
  if (choice === 'saved') fields.forEach((field) => take.add(field));
  const next = rebuilt(operation, row, take);
  if (choice === 'saved' && CLIENT_SET_FIELDS.every((field) => !Object.hasOwn(next, field) || sameValue(next[field], row[field]))) return { action: 'drop' };
  // Values taken from the server were entered there; they are not untouched prefill.
  if (choice === 'saved' && next.value_origin === 'prefill') next.value_origin = 'entered';
  return { action: 'send', data: next };
}
