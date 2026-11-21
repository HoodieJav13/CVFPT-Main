// Look A tracker facts (local, 2026-11-14). Pure helpers over the server's
// workout log; nothing here invents a performed value or a record.
//
// Mappings (docs/look-a/MAPPING.md):
// - x_not_set_tracked   -> workout_log_exercises.not_set_tracked (server flag;
//                          sets untouched) and workout_logs.not_set_tracked.
// - x_prescribed_load_max, x_per_side -> prescribed_load_max, per_side.
// - x_rest_over_seconds -> restOverrunSeconds(stored deadline, now).
// - x_last_time         -> lastTimeSet(history occurrence, set number).
// - x_swapped_from      -> swappedFrom(log, exercise) (the real substitution).
// - x_client_plan       -> clientPlan* below: the person's own numbers for
//                          the remaining sets of one exercise today, kept on
//                          this device only (never a server field). It is
//                          shown on each remaining set and written only when
//                          the person logs that set (planPayload), as their
//                          own entry; the prescription is never copied.

export const undoStorageKey = (logId) => `cvf_look_a_undo:v1:${logId}`;

export function readStoredUndo(logId) {
  try {
    const value = JSON.parse(localStorage.getItem(undoStorageKey(logId)) || 'null');
    return value && typeof value.change_id === 'string' ? value : null;
  } catch { return null; }
}

export function storeUndo(logId, undo) {
  try {
    if (undo && typeof undo.change_id === 'string') localStorage.setItem(undoStorageKey(logId), JSON.stringify(undo));
    else localStorage.removeItem(undoStorageKey(logId));
  } catch { /* the server answer is authoritative; this copy only survives a reload */ }
}

const liveSets = (exercise) => (exercise?.sets || []).filter((set) => !set.archived);

// 'logged' (filled tick): no set left pending and at least one completed.
// 'not_set_tracked' (outlined tick): done without set tracking; sets untouched.
// 'skipped': every set skipped. 'open': still to do.
export function exerciseMark(exercise) {
  if (exercise?.not_set_tracked === true) return 'not_set_tracked';
  const sets = liveSets(exercise);
  if (!sets.length || sets.some((set) => set.status === 'pending')) return 'open';
  return sets.some((set) => set.status === 'completed') ? 'logged' : 'skipped';
}

export const exerciseDone = (exercise) => exerciseMark(exercise) !== 'open';

export function completedSets(exercise) {
  return liveSets(exercise).filter((set) => set.status === 'completed').length;
}

// The person's own words for the exercise's progress chip. A flagged exercise
// never reports sets it did not record.
export function progressText(exercise) {
  const mark = exerciseMark(exercise);
  const sets = liveSets(exercise);
  if (mark === 'not_set_tracked') return completedSets(exercise) ? `Done · ${completedSets(exercise)}/${sets.length} sets logged` : 'Done · sets not logged';
  return `${completedSets(exercise)}/${sets.length}`;
}

// Mirrors mark_workout_exercise_not_set_tracked's refusals so the button is
// only offered when the server would accept it (the server still decides).
export function quickDoneGate(exercise, { sealed = false, conflicts = [] } = {}) {
  if (sealed) return { available: false, reason: 'This workout is already finished.' };
  if (!exercise || exercise.local_only) return { available: false, reason: null };
  if (exercise.not_set_tracked) return { available: false, reason: 'This exercise is already done.' };
  const ids = new Set(liveSets(exercise).map((set) => set.id));
  if ((conflicts || []).some((row) => row.status === 'open' && ids.has(row.workout_log_set_id))) {
    return { available: false, reason: 'A set here has a disagreement waiting for your coach. Record sets one at a time.' };
  }
  if (!liveSets(exercise).some((set) => set.status === 'pending')) return { available: false, reason: null };
  return { available: true, reason: null };
}

// Finish: 'finish' when any set was logged, otherwise the whole workout is
// done without set tracking (never a fabricated set).
export function finishModeFor(log) {
  return (log?.exercises || []).some((exercise) => completedSets(exercise) > 0) ? 'finish' : 'not_set_tracked';
}

// Seconds past the rest deadline, from the stored deadline (kept until the
// person dismisses it), or 0.
export function restOverrunSeconds(endsAt, now = Date.now()) {
  if (!Number.isFinite(endsAt) || now <= endsAt) return 0;
  return Math.floor((now - endsAt) / 1000);
}

// "30–35 lb per side", "40 kg", or null. Units are shown as recorded.
export function prescribedLoadText(exercise) {
  const value = exercise?.prescribed_load_value;
  if (value === null || value === undefined) return exercise?.per_side ? 'per side' : null;
  const max = exercise.prescribed_load_max;
  const range = max !== null && max !== undefined && Number(max) > Number(value) ? `${value}–${max}` : `${value}`;
  return `${range} ${exercise.prescribed_load_unit || 'lb'}${exercise.per_side ? ' per side' : ''}`;
}

// Last time for this set: the same set number of the most recent matching
// occurrence, with its recorded unit, or null (never borrowed from another set).
export function lastTimeSet(occurrence, setNumber) {
  const match = (occurrence?.sets || []).find((set) => set.set_number === setNumber);
  return match || null;
}

// The real substitution this exercise replaces, or null.
export function swappedFrom(log, exercise) {
  if (!exercise?.substitutes_log_exercise_id) return null;
  const original = (log?.exercises || []).find((row) => row.id === exercise.substitutes_log_exercise_id);
  return original ? original.exercise_name : null;
}

// The words on the one Undo button.
export function undoLabel(undo, log) {
  if (!undo) return null;
  const exercise = (id) => (log?.exercises || []).find((row) => row.id === id);
  if (undo.kind === 'exercise_done') return `Undo ${exercise(undo.result?.exercise_id)?.exercise_name || 'exercise'} done`;
  if (undo.kind === 'exercise_skip') return `Undo skip of ${exercise(undo.result?.exercise_id)?.exercise_name || 'exercise'}`;
  if (undo.kind === 'finish') return 'Undo finish';
  if (undo.kind === 'swap') {
    const replacement = exercise(undo.result?.replacement_log_exercise_id);
    const original = exercise(undo.result?.original_log_exercise_id);
    if (replacement && original) return `Undo swap to ${replacement.exercise_name}`;
    return original ? `Undo swap of ${original.exercise_name}` : 'Undo swap';
  }
  if (undo.kind === 'set') {
    const setId = undo.result?.set_id || undo.set_id;
    for (const row of log?.exercises || []) {
      const set = (row.sets || []).find((item) => item.id === setId);
      if (set) return `Undo set ${set.set_number} of ${row.exercise_name}`;
    }
    return 'Undo last set';
  }
  return 'Undo';
}

// The same Undo split for a narrow button: the action (always shown whole) and
// the exercise it applies to (may be shortened on screen). The full sentence
// from undoLabel stays the button's accessible name.
export function undoParts(undo, log) {
  if (!undo) return null;
  const exercise = (id) => (log?.exercises || []).find((row) => row.id === id)?.exercise_name || null;
  if (undo.kind === 'exercise_done') return { action: 'Undo done', target: exercise(undo.result?.exercise_id) };
  if (undo.kind === 'exercise_skip') return { action: 'Undo skip', target: exercise(undo.result?.exercise_id) };
  if (undo.kind === 'finish') return { action: 'Undo finish', target: null };
  if (undo.kind === 'swap') {
    const replacement = exercise(undo.result?.replacement_log_exercise_id);
    const original = exercise(undo.result?.original_log_exercise_id);
    return { action: 'Undo swap', target: replacement && original ? `to ${replacement}` : original };
  }
  if (undo.kind === 'set') {
    const setId = undo.result?.set_id || undo.set_id;
    for (const row of log?.exercises || []) {
      const set = (row.sets || []).find((item) => item.id === setId);
      if (set) return { action: `Undo set ${set.set_number}`, target: row.exercise_name };
    }
    return { action: 'Undo last set', target: null };
  }
  return { action: 'Undo', target: null };
}

// A reply that carries the current Undo replaces it; a set write that changed
// nothing material leaves it as it was (the server recorded nothing).
export function nextUndo(current, reply) {
  if (reply && Object.hasOwn(reply, 'undo')) return reply.undo || null;
  const change = reply?.event?.change;
  if (change === undefined || change === null) return current;
  if (change.undoable) return { change_id: change.id, kind: 'set', result: { set_id: reply.id } };
  // A replay of a change that is no longer current says nothing about the
  // current Undo, unless it is that one.
  return current?.change_id === change.id ? null : current;
}

// ---------- Undo for a change still on its way (lifecycle 4) ----------
// A Look A change's event id IS its server change id (look_a_record), so an
// Undo queued behind it targets exactly that change and is sent only after it
// (FIFO). The offer is the newest undoable queued change; a queued Undo means
// nothing more is offered until its answer (no double Undo, no older inverse
// revived); with nothing queued the server's saved Undo stands. If the queued
// change turns out to change nothing, its reply carries the previous Undo.
export function undoableOp(op) {
  if (!op || op.undoOf) return null;
  if (op.kind === 'set' && op.data?.event_id && op.setId && !String(op.setId).startsWith('pending-')) {
    // A save of numbers on an unlogged set isn't a new action; reopening
    // a logged set still is (its original status is part of the intent).
    if (op.data.status === 'pending' && op.edits && !Object.hasOwn(op.edits, 'status')) return null;
    return { change_id: op.data.event_id, kind: 'set', result: { set_id: op.setId } };
  }
  if (op.kind === 'material' && op.optimistic === 'done' && op.data?.event_id) {
    return { change_id: op.data.event_id, kind: 'exercise_done', result: { exercise_id: op.exerciseId } };
  }
  if (op.kind === 'material' && op.optimistic === 'skip' && op.data?.event_id) {
    return { change_id: op.data.event_id, kind: 'exercise_skip', result: { exercise_id: op.exerciseId, set_ids: (op.data.sets || []).map((row) => row.id) } };
  }
  // A Look A Finish (/finish, with its event id). An older page's /complete has no Undo.
  if (op.kind === 'complete' && op.data?.event_id && /\/finish$/.test(op.url || '')) {
    return { change_id: op.data.event_id, kind: 'finish', result: {}, sent: Boolean(op.sent) };
  }
  if (op.kind === 'substitute' && op.swap?.activate && Array.isArray(op.swap.setIds) && op.data?.id) {
    return { change_id: op.data.id, kind: 'swap', result: { original_log_exercise_id: op.exerciseId, replacement_log_exercise_id: op.swap.replacementId } };
  }
  return null;
}
export function undoOffer(queue, saved) {
  for (let at = (queue || []).length - 1; at >= 0; at -= 1) {
    const op = queue[at];
    if (op.undoOf) return null;
    const offer = undoableOp(op);
    if (offer) return { ...offer, pending: true, opId: op.id, edits: op.kind === 'set' ? (op.edits || {}) : undefined };
  }
  return saved || null;
}

// A pending set ordinarily has no Undo of its own. Restored state from older
// servers may still name one, so hide it unless this page just un-completed
// that set. A draft for another set leaves the prior Log's Undo offered.
export function clientUndoOffer(offer, log, reopened) {
  if (!offer || offer.kind !== 'set') return offer || null;
  const setId = offer.result?.set_id || offer.set_id;
  const set = (log?.exercises || []).flatMap((row) => row.sets || []).find((row) => row.id === setId);
  if (!set || set.status !== 'pending') return offer;
  return reopened?.has?.(setId) ? offer : null;
}

// ---------- x_client_plan: today's adjustment (this device only) ----------
export const planStorageKey = (logId) => `cvf_look_a_plan:v1:${logId}`;

export function readPlans(logId) {
  try {
    const value = JSON.parse(localStorage.getItem(planStorageKey(logId)) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

export function storePlans(logId, plans) {
  try {
    if (plans && Object.keys(plans).length) localStorage.setItem(planStorageKey(logId), JSON.stringify(plans));
    else localStorage.removeItem(planStorageKey(logId));
  } catch { /* a plan is a convenience; logging still works without it */ }
}

const filled = (value) => value !== null && value !== undefined && value !== '';

// The numbers of a set the person logged, as a plan for the rest of today, or
// null when it recorded nothing worth repeating. Only the person's own
// recorded values; units stay as recorded.
export function planFromSet(set) {
  if (!set || set.status !== 'completed') return null;
  const plan = {};
  if (filled(set.actual_reps)) plan.actual_reps = Number(set.actual_reps);
  if (filled(set.actual_load_value)) { plan.actual_load_value = Number(set.actual_load_value); plan.actual_load_unit = set.actual_load_unit || 'lb'; }
  if (filled(set.actual_duration_value)) { plan.actual_duration_value = Number(set.actual_duration_value); plan.actual_duration_unit = set.actual_duration_unit || 's'; }
  if (filled(set.actual_distance_value)) { plan.actual_distance_value = Number(set.actual_distance_value); plan.actual_distance_unit = set.actual_distance_unit || 'm'; }
  return Object.keys(plan).length ? plan : null;
}

// "8 × 135 lb", "45 s", "400 m" — the plan in the person's words.
export function planText(plan) {
  if (!plan) return null;
  const parts = [];
  if (filled(plan.actual_reps) && filled(plan.actual_load_value)) parts.push(`${plan.actual_reps} × ${plan.actual_load_value} ${plan.actual_load_unit}`);
  else if (filled(plan.actual_reps)) parts.push(`${plan.actual_reps} reps`);
  else if (filled(plan.actual_load_value)) parts.push(`${plan.actual_load_value} ${plan.actual_load_unit}`);
  if (filled(plan.actual_duration_value)) parts.push(`${plan.actual_duration_value} ${plan.actual_duration_unit}`);
  if (filled(plan.actual_distance_value)) parts.push(`${plan.actual_distance_value} ${plan.actual_distance_unit}`);
  return parts.join(' · ') || null;
}

const anyValue = (set) => ['actual_load_value', 'actual_reps', 'actual_rpe', 'actual_duration_value', 'actual_distance_value']
  .some((field) => filled(set?.[field]));

// The remaining sets a plan applies to (LOOK-A-FRONTEND-REVIEW 2): pending
// sets whose values the tracker's own rules (setValueView: server origin,
// this device's bound prefill markers, drafts) call untouched, or that hold
// no value at all. Never a set being typed into, held, waiting for a choice
// or with a write still queued (`blocked`), and never one whose values are
// entered, ambiguous or not yet resolved: those keep the person's numbers.
// `viewOf` gives the raw view, including 'unresolved'.
export function planTargets(exercise, { viewOf = (set) => set.value_view, blocked = () => false } = {}) {
  return liveSets(exercise).filter((set) => {
    if (set.status !== 'pending' || blocked(set.id)) return false;
    const view = viewOf(set);
    if (view === 'untouched') return true;
    return view === 'entered' && !anyValue(set);
  });
}

// The set write that logs this set with today's plan: completed, the plan's
// values as the person's own entry. Fields the plan does not hold stay as the
// set has them (a prefilled load stays a prefill, never relabelled).
export function planPayload(set, plan) {
  if (!plan) return null;
  return { ...set, ...plan, status: 'completed' };
}

// ---------- Home Quick Complete: the one Undo, after leaving the tracker ----------
export const homeUndoKey = 'cvf_look_a_home_undo:v1';

// One pointer, two shapes (LOOK-A-HOME-UNDO-REVIEW 1):
//   {state:'pending', source, event_id, workout_name} — written BEFORE the
//     Mark done request, so a reload mid-request or after a lost reply still
//     offers Undo and replays the SAME event id (never a new start);
//   {state:'saved', logId, change_id, workout_name, undo_event_id?} — the
//     server's answer; undo_event_id is written before the Undo is sent.
// Older saved pointers without `state` still read as saved.
export function normalizeHomeUndo(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.state === 'pending') {
    return typeof value.event_id === 'string' && value.source && typeof value.source === 'object'
      ? { state: 'pending', source: value.source, event_id: value.event_id, workout_name: value.workout_name ?? null } : null;
  }
  if ((value.state === 'saved' || value.state === undefined) && typeof value.logId === 'string' && typeof value.change_id === 'string') {
    return { state: 'saved', logId: value.logId, change_id: value.change_id, workout_name: value.workout_name ?? null,
      ...(typeof value.undo_event_id === 'string' ? { undo_event_id: value.undo_event_id } : {}) };
  }
  return null;
}
export function readHomeUndo() {
  try { return normalizeHomeUndo(JSON.parse(localStorage.getItem(homeUndoKey) || 'null')); } catch { return null; }
}
// Which change a pointer is about; replies are fenced by it.
export const homeUndoIdentity = (value) => (!value ? null
  : value.state === 'pending' ? `pending:${value.event_id}` : `saved:${value.change_id}`);

export function storeHomeUndo(value) {
  try {
    if (value) localStorage.setItem(homeUndoKey, JSON.stringify(value));
    else localStorage.removeItem(homeUndoKey);
  } catch { /* the server answer decides; this only survives a reload */ }
}
// Compare-and-set: replace the pointer only while it is still the one this
// operation started from (another tap, tab or reply may have moved it on).
export function swapHomeUndo(expectedIdentity, next) {
  if (homeUndoIdentity(readHomeUndo()) !== expectedIdentity) return false;
  storeHomeUndo(next);
  return true;
}

// What a Mark done reply means now (LOOK-A-HOME-UNDO-REVIEW 2). Only a log
// that is completed NOW is a completion to celebrate; a replay whose workout
// was undone since (status active) is history: acknowledged, never announced,
// no check-in, no coach-notified message.
export function homeQuickReply(done) {
  const current = done?.status === 'completed' && typeof done?.id === 'string';
  return {
    current,
    undo: current && done?.change?.undoable === true && typeof done.change.id === 'string'
      ? { state: 'saved', logId: done.id, change_id: done.change.id, workout_name: done.workout_name || null } : null,
  };
}

// One Home tap keeps one event id until the server answers it, so a retry
// (after a lost reply or a reload) replays instead of finishing twice.
export const homeQuickKey = 'cvf_look_a_home_quick:v1';
export function homeQuickEventId(source, makeId) {
  const wanted = JSON.stringify(source || {});
  try {
    const stored = JSON.parse(localStorage.getItem(homeQuickKey) || 'null');
    if (stored && stored.source === wanted && typeof stored.event_id === 'string') return stored.event_id;
  } catch { /* a fresh id below */ }
  const eventId = makeId();
  try { localStorage.setItem(homeQuickKey, JSON.stringify({ source: wanted, event_id: eventId })); } catch { /* still sent once */ }
  return eventId;
}
export function forgetHomeQuick() {
  try { localStorage.removeItem(homeQuickKey); } catch { /* nothing kept */ }
}

// A Finish reply ({result, log, undo}) as the outbox needs it. 'applied' is
// a CURRENT completion: the workout is finished now. A replay of a Finish
// that was applied and has since been undone (or a workout that is active
// again) is only 'delivered': the event is acknowledged, nothing is
// celebrated and the reopened workout stays open (LOOK-A-FRONTEND-REVIEW 1).
export function finishReply(data) {
  const result = data?.result || null;
  const log = data?.log || null;
  const outcome = result?.outcome === 'replayed' ? result.original_outcome : result?.outcome;
  const finishedNow = outcome === 'applied' && result?.undone !== true && !(log?.status && log.status !== 'completed');
  return {
    applied: finishedNow,
    delivered: outcome === 'applied' && !finishedNow,
    refused: outcome === 'refused',
    reason: result?.reason || null,
    log,
    undo: data?.undo ?? null,
  };
}
