// Exercise-scoped quick completion for the normal tracker (final review
// 2026-11-12 #5). Pure rules over the tracker's log shape, unit-tested in
// tests/unit/exerciseQuickComplete.test.mjs. Same semantics as the rehearsal's
// "Record N remaining as entered": every remaining set of ONE exercise is
// recorded as done with exactly what the person entered. Nothing is copied
// from the prescription: a load that is still the untouched prescribed prefill
// is not the person's entry, so that set is recorded without a weight. True
// blanks stay blank. The action is all-or-nothing and comes with a grouped,
// time-limited Undo that only reverses sets nobody has changed since.
import { performedSet, trackingType, tracks } from './workoutMetrics.js';
import { isUntouchedPrefill } from './workoutGuide.js';

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
export function exerciseQuickPlan(exercise, { sealed = false, conflicts = [] } = {}) {
  const remaining = (exercise?.sets || []).filter((set) => set.status === 'pending');
  if (sealed || remaining.length === 0) return { available: false, reason: null, entries: [], withDetails: 0, without: 0 };
  const conflicted = remaining.find((set) => (conflicts || []).some((row) => row.workout_log_set_id === set.id && row.status === 'open'));
  if (conflicted) {
    return { available: false, reason: `Set ${conflicted.set_number} has a disagreement waiting for your coach. Record sets one at a time.`, entries: [], withDetails: 0, without: 0 };
  }
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
    entries.push({ setId: set.id, setNumber: set.set_number, payload, restore });
  }
  const without = remaining.length - withDetails;
  const label = `Record ${remaining.length} remaining as entered (${withDetails} with details, ${without} without)`;
  return { available: true, reason: null, entries, withDetails, without, label };
}

const SAME_KEYS = ['actual_load_value', 'actual_load_unit', 'actual_reps', 'actual_rpe', 'actual_duration_value', 'actual_duration_unit', 'actual_distance_value', 'actual_distance_unit'];
const sameValue = (a, b) => (blank(a) && blank(b)) || (!blank(a) && !blank(b) && String(a) === String(b));

/**
 * Grouped Undo for one exercise quick completion. Available only inside the
 * window and only when every set it recorded is still completed with exactly
 * the recorded values (nobody changed it since). Returns
 * { available, reason, entries: [{ setId, payload }] } restoring each set to
 * pending with the values it had before (including any prefill).
 */
export function exerciseUndoPlan(record, exercise, { nowMs, sealed = false } = {}) {
  if (!record || sealed) return { available: false, reason: null, entries: [] };
  if (nowMs >= record.expiresMs) return { available: false, reason: 'Undo time is over.', entries: [] };
  const sets = new Map((exercise?.sets || []).map((set) => [set.id, set]));
  for (const entry of record.entries) {
    const current = sets.get(entry.setId);
    if (!current || current.status !== 'completed') return { available: false, reason: 'A set changed since; undo it one set at a time.', entries: [] };
    if (SAME_KEYS.some((key) => key in entry.payload && !sameValue(current[key], entry.payload[key]))) {
      return { available: false, reason: 'A set changed since; undo it one set at a time.', entries: [] };
    }
  }
  return { available: true, reason: null, entries: record.entries.map((entry) => ({ setId: entry.setId, payload: entry.restore })) };
}
