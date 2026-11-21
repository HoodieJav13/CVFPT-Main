// Exercise-scoped quick completion for the normal tracker (final review
// 2026-11-12 #5). Pure rules over the tracker's log shape, unit-tested in
// tests/unit/exerciseQuickComplete.test.mjs. Same semantics as the rehearsal's
// "Record N remaining as entered": every remaining set of ONE exercise is
// recorded as done with exactly what the person entered. Nothing is copied
// from the prescription: a load that is still the untouched prescribed prefill
// is not the person's entry, so that set is recorded without a weight. True
// blanks stay blank. The action is all-or-nothing and comes with a grouped,
// time-limited Undo that only reverses sets nobody has changed since. Undo
// returns the whole previous state the action changed (owner decision
// 2026-11-12, "Undo restores everything as it was, skipped sets included"):
// the sets it recorded, their typed-draft markers and the rest timer. Sets it
// did not touch (completed, skipped) are never written.
import { performedSet, trackingType, tracks } from './workoutMetrics.js';
import { isUntouchedPrefill, prescribedPrefillOnly } from './workoutGuide.js';

export const EXERCISE_UNDO_MS = 6000;

const blank = (value) => value === '' || value === null || value === undefined;

/** True when the set holds a performed value the person entered (prefill excluded). */
export function hasEnteredValues(exercise, set) {
  if (isUntouchedPrefill(exercise, set)) return false;
  if (!blank(set.actual_load_value)) return true;
  if (trackingType(exercise) === 'reps_weight' && !blank(set.actual_reps)) return true;
  if (!blank(set.actual_rpe)) return true;
  return ['duration', 'distance'].some((metric) => tracks(exercise, metric) && !blank(set[`actual_${metric}_value`]));
}

/**
 * Plan for recording every remaining (pending) set of `exercise`.
 * Returns { available, reason, entries, withDetails, without, label }.
 * entries: [{ setId, setNumber, payload, restore }] where payload completes
 * the set with the entered values only and restore reopens it unchanged.
 */
export function exerciseQuickPlan(exercise, { sealed = false, conflicts = [], draftIds = null, unresolved = null } = {}) {
  const remaining = (exercise?.sets || []).filter((set) => set.status === 'pending');
  if (sealed || remaining.length === 0) return { available: false, reason: null, entries: [], withDetails: 0, without: 0 };
  const conflicted = remaining.find((set) => (conflicts || []).some((row) => row.workout_log_set_id === set.id && row.status === 'open'));
  if (conflicted) {
    return { available: false, reason: `Set ${conflicted.set_number} has a disagreement waiting for your coach. Record sets one at a time.`, entries: [], withDetails: 0, without: 0 };
  }
  // Whose value an unresolved set holds is not known yet (see
  // prefillMarkerState): recording it could invent or discard a weight.
  if (unresolved && remaining.some((set) => set.id === unresolved.setId)) {
    // checking (Ultra F2): a replayed reply showed the server's current row,
    // which may be newer than the values on screen, until a refresh lands.
    const reason = unresolved.choosing
      ? CHOICE_SET_REASON(unresolved.setNumber)
      : unresolved.checking
      ? HELD_SET_REASON(unresolved.setNumber)
      : unresolved.queued
        ? `Set ${unresolved.setNumber} is still confirming your Undo. Record sets one at a time, or wait for it to save.`
        : `Set ${unresolved.setNumber}'s earlier Undo could not be confirmed. Check its values and record it on its own.`;
    return { available: false, reason, entries: [], withDetails: 0, without: 0 };
  }
  // A load nobody can attribute (see setValueView): it may be the untouched
  // prescription or someone's entry, so it is neither recorded nor stripped.
  const ambiguous = remaining.find((set) => set.value_view === 'ambiguous');
  if (ambiguous) return { available: false, reason: AMBIGUOUS_PREFILL_REASON(ambiguous.set_number), ambiguousSetId: ambiguous.id, entries: [], withDetails: 0, without: 0 };
  const entries = [];
  let withDetails = 0;
  for (const set of remaining) {
    const entered = hasEnteredValues(exercise, set);
    if (entered) withDetails += 1;
    // An untouched prefill load is the prescription, not a performed value.
    const performed = entered ? set : { ...set, actual_load_value: null, actual_load_unit: null };
    let payload;
    let restore;
    try {
      payload = performedSet({ ...performed, status: 'completed' }, exercise);
      restore = performedSet({ ...set, status: 'pending' }, exercise);
    } catch {
      return { available: false, reason: `Set ${set.set_number} has an entry to fix first.`, invalidSetId: set.id, entries: [], withDetails: 0, without: 0 };
    }
    // draft: the set was being typed into (not yet saved) before the action.
    // prefill: it held only the untouched prescribed prefill.
    entries.push({ setId: set.id, setNumber: set.set_number, payload, restore, draft: Boolean(draftIds?.has(set.id)), prefill: isUntouchedPrefill(exercise, set) });
  }
  const without = remaining.length - withDetails;
  const label = `Record ${remaining.length} remaining as entered (${withDetails} with details, ${without} without)`;
  return { available: true, reason: null, entries, withDetails, without, label };
}

const SAME_KEYS = ['actual_load_value', 'actual_load_unit', 'actual_reps', 'actual_rpe', 'actual_duration_value', 'actual_duration_unit', 'actual_distance_value', 'actual_distance_unit'];
const sameValue = (a, b) => (blank(a) && blank(b)) || (!blank(a) && !blank(b) && String(a) === String(b));

/**
 * Rest timer on Undo. The record keeps the absolute deadline from before the
 * action (restBefore, null for none) and how many timers had been started by
 * then (restStarts). If no newer timer was started since, the action's timer
 * (even if the person adjusted or ended it) is replaced by the previous one:
 * the same deadline, never restarted or extended, so a deadline that has
 * already passed reads as finished, as it would have. A timer started after
 * the action (another set, or Start rest) is newer input and stays.
 * Returns { apply, endsAt }: endsAt is the timer to show (null for none).
 */
export function undoRestTarget(record, current = {}) {
  const endsAt = current.endsAt ?? null;
  if (!record || !Number.isInteger(record.restStarts) || !('restBefore' in record)) return { apply: false, endsAt };
  if (current.starts !== record.restStarts) return { apply: false, endsAt };
  return { apply: true, endsAt: record.restBefore ?? null };
}

const refused = (reason, current) => ({ available: false, reason, entries: [], draftIds: [], prefillIds: [], rest: { apply: false, endsAt: current?.endsAt ?? null } });

/**
 * Grouped Undo for one exercise quick completion. Available only inside the
 * window, only once, and only when every set it recorded is still completed
 * with exactly the recorded values (nobody changed it since). Returns
 * { available, reason, entries: [{ setId, payload }], draftIds, rest }:
 * entries restore each set to pending with the values it had before
 * (including any prefill), draftIds are the sets that were being typed into,
 * and rest is the timer decision from undoRestTarget.
 */
export function exerciseUndoPlan(record, exercise, { nowMs, sealed = false, rest = undefined } = {}) {
  if (!record || sealed || record.used) return refused(null, rest);
  if (nowMs >= record.expiresMs) return refused('Undo time is over.', rest);
  const sets = new Map((exercise?.sets || []).map((set) => [set.id, set]));
  for (const entry of record.entries) {
    const current = sets.get(entry.setId);
    if (!current || current.status !== 'completed') return refused('A set changed since; undo it one set at a time.', rest);
    if (SAME_KEYS.some((key) => key in entry.payload && !sameValue(current[key], entry.payload[key]))) {
      return refused('A set changed since; undo it one set at a time.', rest);
    }
  }
  return {
    available: true,
    reason: null,
    entries: record.entries.map((entry) => ({ setId: entry.setId, payload: entry.restore })),
    draftIds: record.entries.filter((entry) => entry.draft).map((entry) => entry.setId),
    prefillIds: record.entries.filter((entry) => entry.prefill).map((entry) => entry.setId),
    rest: undoRestTarget(record, rest),
  };
}

/**
 * Undo writes an untouched set back with its prescribed prefill, and the
 * server moves the set's revision on (history is not rewritten), so by the
 * revision rule it would now read as the person's own entry and a later quick
 * completion would record the prescription as performed. markers (set id ->
 * marker, kept on this device) name the sets Undo returned to an untouched
 * prefill. A marker is bound to the exact state Undo wrote (independent
 * finding 01, 2026-11-12), never to the set id alone:
 *   { op, base }   the Undo write is queued (operation id op), not yet
 *                  acknowledged; valid while the set is still at revision base;
 *   { revision, updated_at }
 *                  the server applied it (a fresh 'applied' reply) and returned
 *                  this row; valid only while the set is at exactly that
 *                  revision and, when rows carry updated_at, that same stamp.
 *                  A write that does not move the revision (the legacy
 *                  no-event PATCH, even with the same value) changes the stamp
 *                  (Ultra F1, 2026-11-12). A marker without a stamp is trusted
 *                  only against rows without one (synthetic/preview shapes).
 * Any newer revision (another device, the coach, a later save fetched by a
 * refresh or reload) is newer input and the marker no longer applies, so an
 * explicitly saved value is never stripped. A valid marked set that is still
 * pending with only the prescription is evaluated as untouched. Rules only;
 * the real revision is still what every write is based on.
 */
// One instant, whatever the spelling ('Z' or '+00:00', trimmed fraction):
// seconds since the epoch plus the fraction to microseconds, or null.
const stampKey = (value) => {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d(?::?\d\d)?)$/i.exec(value.trim());
  if (!match) return null;
  const zone = /^[+-]\d\d$/.test(match[3]) ? `${match[3]}:00` : match[3];
  const seconds = Date.parse(`${match[1].replace(' ', 'T')}${zone}`);
  if (!Number.isFinite(seconds)) return null;
  return `${seconds / 1000}.${(match[2] || '').padEnd(6, '0').slice(0, 6)}`;
};
// A bound marker still describes the row only if the row keeps the stamp its
// own write produced. Rows without a stamp keep the revision rule alone.
const sameStamp = (marker, set) => {
  if (blank(set.updated_at)) return true;
  const key = stampKey(set.updated_at);
  return key !== null && key === stampKey(marker.updated_at);
};
const markerRevision = (marker) => {
  if (!marker || typeof marker !== 'object') return null;
  if (Number.isInteger(marker.revision)) return marker.revision;
  if (typeof marker.op === 'string' && Number.isInteger(marker.base)) return marker.base;
  return null;
};

export function withRestoredPrefill(exercise, markers) {
  if (!exercise || !markers || !Object.keys(markers).length) return exercise;
  let changed = false;
  const sets = (exercise.sets || []).map((set) => {
    if (markers[set.id]?.origin === 'entered') return set;
    const revision = markerRevision(markers[set.id]);
    if (revision === null || set.status !== 'pending' || !Number.isInteger(set.revision) || set.revision !== revision) return set;
    if (Number.isInteger(markers[set.id].revision) && !sameStamp(markers[set.id], set)) return set;
    const untouched = { ...set, revision: 0 };
    if (!isUntouchedPrefill(exercise, untouched)) return set;
    changed = true;
    return untouched;
  });
  return changed ? { ...exercise, sets } : exercise;
}

/**
 * What a restored-prefill marker says about a set (independent finding 02):
 * - 'untouched': the set still holds exactly what this device's Undo wrote,
 *   at the revision the marker is bound to (or, while the Undo write is queued,
 *   at the revision it was based on, not yet applied).
 * - 'unresolved': the Undo write was sent but its acknowledgement has not
 *   arrived (or its operation is gone without one), and the set has moved to
 *   another revision. That revision may be this device's own committed Undo or
 *   someone else's newer value; only the acknowledgement can tell, so the set
 *   may be neither recorded as performed nor stripped as prefill.
 * - 'none': no usable marker; the ordinary rules apply (a newer bound revision
 *   is the person's entry: independent finding 01).
 * Queued or not, an unacknowledged move is unresolved; whether the operation
 * is still in the outbox (isQueued below) only changes the recovery wording.
 */
// Markers with origin 'entered' (cross-device Undo, 2026-11-12) record this
// device's own explicit writes, so an old server's revision rule does not gate
// them; a moved entered marker is simply no longer this device's value.
export function prefillMarkerState(set, marker) {
  const revision = markerRevision(marker);
  if (revision === null || !set || set.status !== 'pending' || !Number.isInteger(set.revision)) return 'none';
  if (set.revision === revision) {
    // Bound: only while the row still holds what its own write produced (F1).
    // Queued ({ op, base }): the row has not been written by it yet.
    if (Number.isInteger(marker.revision) && !sameStamp(marker, set)) return 'none';
    return 'untouched';
  }
  return typeof marker.op === 'string' && marker.origin !== 'entered' ? 'unresolved' : 'none';
}

/** The first pending set of `exercise` whose marker is unresolved, as { setId, setNumber, queued }, or null. */
export function unresolvedPrefillSet(exercise, markers, isQueued = () => false) {
  if (!exercise || !markers) return null;
  for (const set of exercise.sets || []) {
    const marker = markers[set.id];
    if (prefillMarkerState(set, marker) === 'unresolved') {
      return { setId: set.id, setNumber: set.set_number, queued: Boolean(isQueued(marker.op)) };
    }
  }
  return null;
}

/**
 * A queued marker becomes bound when its own write is acknowledged as freshly
 * 'applied': that reply is the row this write produced, so the marker keeps its
 * revision and updated_at. Every other reply retires it (null):
 *  - a conflict (the server kept someone else's value);
 *  - a reply without a revision;
 *  - a replay (Ultra F2, 2026-11-12): the server answers a repeated event with
 *    the CURRENT row, which may hold another device's newer value at a newer
 *    revision, not the state the original write produced. Without the marker
 *    the server origin decides (new schema), or the old-server rules gate a
 *    load nobody can attribute; nothing is stripped or invented.
 * Other operations leave it unchanged.
 */
export function ackPrefillMarker(marker, operation, response) {
  if (!marker || typeof marker.op !== 'string' || operation?.id !== marker.op) return marker;
  if (response?.event?.outcome !== 'applied' || !Number.isInteger(response?.revision)) return null;
  const bound = { revision: response.revision };
  if (!blank(response.updated_at)) bound.updated_at = response.updated_at;
  if (marker.origin === 'entered') bound.origin = 'entered';
  return bound;
}

/** A set held after a replayed reply (F3): nothing may be written for it until a refresh lands. */
export const HELD_SET_REASON = (setNumber) => `Set ${setNumber} is checking for newer saved values. Wait a moment before changing it.`;
// A draft whose typed field was also changed on another device waits for the person's explicit choice.
export const CHOICE_SET_REASON = (setNumber) => `Set ${setNumber} was also changed on another device. Choose which values to keep first.`;

export const AMBIGUOUS_PREFILL_REASON = (setNumber) => `Set ${setNumber} may still be the prescribed weight. Record it on its own or enter what you did.`;

const performedMetric = (set) => !blank(set.actual_reps) || !blank(set.actual_rpe)
  || !blank(set.actual_duration_value) || !blank(set.actual_distance_value);

/**
 * What a pending set's values mean (cross-device Undo, 2026-11-12):
 * 'untouched' (only the untouched prescribed prefill: never recorded as
 * performed), 'entered' (someone's entry, or nothing to invent), 'ambiguous'
 * (a load nobody can attribute: gated), 'unresolved' (this device's own Undo
 * is still unconfirmed: the finding 02 gate), or null for a set that is not
 * pending. In order:
 *  1. a set being typed into is the person's entry;
 *  2. this device's own Undo that is not acknowledged yet while the set moved
 *     on is 'unresolved' (the finding 02 gate), on any server;
 *  3. a server row with value_origin (new schema) is authoritative; this
 *     device's markers never override it (Ultra F1): prefill is untouched even
 *     if the prescription changed since, entered is entered, a legacy row
 *     nobody wrote since the start that still equals the prescription is
 *     untouched; anything else with a performed metric or no load is entered,
 *     and a remaining load is ambiguous (unknown, or history nobody can prove);
 *  4. an old server row (no value_origin): this device's own marker, bound to
 *     the exact row its acknowledged write produced (revision and stamp: its
 *     Undo restoring the prefill, or its own explicit save), then the original
 *     revision-0 rule, then
 *     performed metrics or no load are entered; a load-only set at a newer
 *     revision may be another device's restored prefill, so it is ambiguous.
 */
export function setValueView(exercise, set, { marker = null, draft = false } = {}) {
  if (!set || set.status !== 'pending') return null;
  if (draft) return 'entered';
  const state = prefillMarkerState(set, marker);
  if (state === 'unresolved') return 'unresolved';
  if (Object.hasOwn(set, 'value_origin')) {
    if (performedMetric(set) || set.value_origin === 'entered') return 'entered';
    if (set.value_origin === 'prefill') return 'untouched';
    if (blank(set.actual_load_value)) return 'entered';
    if (set.value_origin === 'legacy' && !(set.revision > 0) && !set.last_actor_role && prescribedPrefillOnly(exercise, set)) return 'untouched';
    return 'ambiguous';
  }
  if (state === 'untouched') return marker.origin === 'entered' || performedMetric(set) ? 'entered' : 'untouched';
  if (prescribedPrefillOnly(exercise, set)) return 'untouched';
  if (performedMetric(set) || blank(set.actual_load_value)) return 'entered';
  return Number.isInteger(set.revision) && set.revision > 0 ? 'ambiguous' : 'entered';
}

/** The exercise with value_view on each pending set (the tracker's rules view). */
export function annotateValueViews(exercise, markers = {}, { draftIds = null } = {}) {
  if (!exercise) return exercise;
  return {
    ...exercise,
    sets: (exercise.sets || []).map((set) => {
      const valueView = setValueView(exercise, set, { marker: markers?.[set.id] || null, draft: Boolean(draftIds?.has(set.id)) });
      // 'unresolved' is gated by unresolvedPrefillSet; until then the set is not recordable as untouched.
      return valueView ? { ...set, value_view: valueView === 'unresolved' ? 'entered' : valueView } : set;
    }),
  };
}
