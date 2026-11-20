// Look A tracker facts (local, 2026-11-14).
import test from 'node:test';
import assert from 'node:assert/strict';
import { finishReply, undoOffer, undoableOp, planFromSet, planPayload, planTargets, planText, exerciseMark, progressText, quickDoneGate, finishModeFor, restOverrunSeconds, prescribedLoadText, lastTimeSet, swappedFrom, undoLabel, undoParts, nextUndo, clientUndoOffer } from '../../src/lib/lookA.js';

const set = (n, status = 'pending', extra = {}) => ({ id: `s${n}`, set_number: n, status, ...extra });
const ex = (sets, extra = {}) => ({ id: 'e1', exercise_name: 'Fictional Press', sets, ...extra });

test('marks: logged (filled), done without set tracking (outlined), skipped, open', () => {
  assert.equal(exerciseMark(ex([set(1, 'completed'), set(2, 'skipped')])), 'logged');
  assert.equal(exerciseMark(ex([set(1), set(2)], { not_set_tracked: true })), 'not_set_tracked');
  assert.equal(exerciseMark(ex([set(1, 'skipped')])), 'skipped');
  assert.equal(exerciseMark(ex([set(1, 'completed'), set(2)])), 'open');
  assert.equal(exerciseMark(ex([])), 'open');
});

test('a flagged exercise never reports sets it did not record', () => {
  assert.equal(progressText(ex([set(1), set(2)], { not_set_tracked: true })), 'Done · sets not logged');
  assert.equal(progressText(ex([set(1, 'completed'), set(2)], { not_set_tracked: true })), 'Done · 1/2 sets logged');
  assert.equal(progressText(ex([set(1, 'completed'), set(2)])), '1/2');
});

test('quick done is offered only where the server would accept it', () => {
  assert.deepEqual(quickDoneGate(ex([set(1)])), { available: true, reason: null });
  assert.equal(quickDoneGate(ex([set(1)]), { sealed: true }).available, false);
  assert.equal(quickDoneGate(ex([set(1)], { not_set_tracked: true })).reason, 'This exercise is already done.');
  assert.match(quickDoneGate(ex([set(1)]), { conflicts: [{ status: 'open', workout_log_set_id: 's1' }] }).reason, /disagreement/);
  assert.equal(quickDoneGate(ex([set(1, 'completed')])).available, false);
});

test('finish mode: any logged set finishes normally, none means not set-tracked', () => {
  assert.equal(finishModeFor({ exercises: [ex([set(1, 'completed')])] }), 'finish');
  assert.equal(finishModeFor({ exercises: [ex([set(1)], { not_set_tracked: true })] }), 'not_set_tracked');
});

test('rest overrun comes from the kept deadline', () => {
  assert.equal(restOverrunSeconds(1000, 500), 0);
  assert.equal(restOverrunSeconds(1000, 13_500), 12);
  assert.equal(restOverrunSeconds(null, 13_500), 0);
});

test('load text keeps the recorded unit, range and per side', () => {
  assert.equal(prescribedLoadText({ prescribed_load_value: 30, prescribed_load_max: 35, prescribed_load_unit: 'kg', per_side: true }), '30–35 kg per side');
  assert.equal(prescribedLoadText({ prescribed_load_value: 30, prescribed_load_max: 30, prescribed_load_unit: null }), '30 lb');
  assert.equal(prescribedLoadText({ prescribed_load_value: null }), null);
});

test('last time is the same set number only, unit kept', () => {
  const occurrence = { sets: [{ set_number: 1, actual_load_value: 20, actual_load_unit: 'kg' }] };
  assert.deepEqual(lastTimeSet(occurrence, 1), { set_number: 1, actual_load_value: 20, actual_load_unit: 'kg' });
  assert.equal(lastTimeSet(occurrence, 2), null);
});

test('swapped from names the real original', () => {
  const log = { exercises: [{ id: 'o', exercise_name: 'Split Squat' }, { id: 'r', exercise_name: 'Step Up', substitutes_log_exercise_id: 'o' }] };
  assert.equal(swappedFrom(log, log.exercises[1]), 'Split Squat');
  assert.equal(swappedFrom(log, log.exercises[0]), null);
});

test('one Undo: labelled, replaced by the next material change, kept otherwise', () => {
  const log = { exercises: [ex([set(1), set(2)])] };
  assert.equal(undoLabel({ change_id: 'c', kind: 'exercise_done', result: { exercise_id: 'e1' } }, log), 'Undo Fictional Press done');
  assert.equal(undoLabel({ change_id: 'c', kind: 'set', result: { set_id: 's2' } }, log), 'Undo set 2 of Fictional Press');
  assert.equal(undoLabel({ change_id: 'c', kind: 'set', result: {} }, log), 'Undo last set');
  assert.equal(undoLabel({ change_id: 'c', kind: 'finish' }, log), 'Undo finish');
  assert.deepEqual(undoParts({ change_id: 'c', kind: 'exercise_done', result: { exercise_id: 'e1' } }, log), { action: 'Undo done', target: 'Fictional Press' });
  assert.deepEqual(undoParts({ change_id: 'c', kind: 'set', result: { set_id: 's2' } }, log), { action: 'Undo set 2', target: 'Fictional Press' });
  assert.deepEqual(undoParts({ change_id: 'c', kind: 'finish' }, log), { action: 'Undo finish', target: null });
  const current = { change_id: 'a', kind: 'exercise_done' };
  assert.deepEqual(nextUndo(current, { undo: null }), null);
  assert.deepEqual(nextUndo(current, { id: 's1', event: { change: null } }), current, 'non-material write keeps it');
  assert.deepEqual(nextUndo(current, { id: 's1', event: { change: { id: 'b', undoable: true } } }), { change_id: 'b', kind: 'set', result: { set_id: 's1' } });
  assert.deepEqual(nextUndo(current, { id: 's1', event: { change: { id: 'old', undoable: false } } }), current, 'old replay says nothing');
  assert.deepEqual(nextUndo(current, { id: 's1', event: { change: { id: 'a', undoable: false } } }), null);
});

// x_client_plan (LOOK-A-HANDOFF-REVIEW.md item 5): today's numbers apply only
// to remaining sets the person has not typed into, and are written only as
// the person's own logged set; the prescription is never copied.
test('client plan: from a logged set, only recorded values, units as recorded', () => {
  assert.equal(planFromSet({ status: 'pending', actual_reps: 8 }), null);
  assert.equal(planFromSet({ status: 'completed', actual_reps: null, actual_load_value: null }), null);
  assert.deepEqual(planFromSet({ status: 'completed', actual_reps: 9, actual_load_value: 60, actual_load_unit: 'kg' }),
    { actual_reps: 9, actual_load_value: 60, actual_load_unit: 'kg' });
  assert.equal(planText({ actual_reps: 9, actual_load_value: 60, actual_load_unit: 'kg' }), '9 × 60 kg');
  assert.equal(planText({ actual_duration_value: 45, actual_duration_unit: 's' }), '45 s');
});
test('client plan: targets follow the value rules, never typed, unknown or queued values', () => {
  const exercise = { sets: [
    { id: 'a', status: 'completed', value_view: undefined },
    { id: 'b', status: 'pending', value_view: 'entered', actual_reps: 6 },
    { id: 'c', status: 'pending', value_view: 'untouched', actual_load_value: 60, actual_load_unit: 'kg' },
    { id: 'd', status: 'pending', value_view: 'untouched' },
    { id: 'e', status: 'pending', value_view: 'untouched', archived: true },
    { id: 'f', status: 'pending', value_view: 'ambiguous', actual_load_value: 40, actual_load_unit: 'kg' },
    { id: 'g', status: 'pending', value_view: 'entered' },
    { id: 'h', status: 'pending', value_view: 'untouched' },
    { id: 'i', status: 'pending', value_view: 'unresolved' },
  ] };
  // d is being typed into; h has a write still queued.
  assert.deepEqual(planTargets(exercise, { blocked: (id) => id === 'd' || id === 'h' }).map((set) => set.id), ['c', 'g']);
  // An origin alone never decides: a legacy/unknown row with a typed 6 x 40 kg is the rules' 'entered'.
  const legacy = { sets: [{ id: 'x', status: 'pending', value_origin: 'unknown', actual_reps: 6, actual_load_value: 40, actual_load_unit: 'kg' }] };
  assert.deepEqual(planTargets(legacy, { viewOf: () => 'entered' }), []);
  assert.deepEqual(planTargets(legacy, { viewOf: () => 'ambiguous' }), []);
});
test('client plan: the confirmed result is the whole set (plan over what the set holds)', () => {
  const set = { id: 'c', status: 'pending', actual_load_value: 60, actual_load_unit: 'kg', actual_reps: null };
  assert.equal(planText(planPayload(set, { actual_reps: 8 })), '8 × 60 kg');
  assert.equal(planText(planPayload(set, { actual_reps: 8, actual_load_value: 135, actual_load_unit: 'lb' })), '8 × 135 lb');
});
test('client plan: logging writes the plan as completed; nothing else changes', () => {
  const set = { id: 'c', status: 'pending', actual_load_value: 135, actual_load_unit: 'lb', actual_reps: null, set_number: 2 };
  assert.deepEqual(planPayload(set, { actual_reps: 8 }), { ...set, actual_reps: 8, status: 'completed' });
  assert.equal(planPayload(set, null), null);
});
test('finish reply: applied, refused and replayed answers', () => {
  assert.equal(finishReply({ result: { outcome: 'applied' }, log: { id: 'x' }, undo: { change_id: 'f' } }).applied, true);
  assert.equal(finishReply({ result: { outcome: 'replayed', original_outcome: 'applied' }, log: { status: 'completed' } }).applied, true);
  // Lost-ack Finish, then Undo, then the late replay: delivered, not finished now.
  const late = finishReply({ result: { outcome: 'replayed', original_outcome: 'applied', undone: true }, log: { id: 'x', status: 'active' }, undo: null });
  assert.equal(late.applied, false);
  assert.equal(late.delivered, true);
  assert.equal(late.refused, false);
  const reopened = finishReply({ result: { outcome: 'replayed', original_outcome: 'applied' }, log: { id: 'x', status: 'active' } });
  assert.equal(reopened.applied, false);
  assert.equal(reopened.delivered, true);
  const refused = finishReply({ result: { outcome: 'refused', reason: 'complete_at_least_one_set' }, log: null });
  assert.equal(refused.refused, true);
  assert.equal(refused.reason, 'complete_at_least_one_set');
});
test('undo label: swap names the replacement', () => {
  const log = { exercises: [{ id: 'o', exercise_name: 'Back Squat' }, { id: 'r', exercise_name: 'Goblet Squat' }] };
  assert.equal(undoLabel({ kind: 'swap', result: { original_log_exercise_id: 'o', replacement_log_exercise_id: 'r' } }, log), 'Undo swap to Goblet Squat');
  assert.equal(undoLabel({ kind: 'swap', result: { original_log_exercise_id: 'o', replacement_log_exercise_id: 'gone' } }, log), 'Undo swap of Back Squat');
});

// Undo for a change still on its way (LOOK-A-FRONTEND-LIFECYCLE-REVIEW 4).
const setOp = (id, setId, eventId, edits = {}) => ({ id, kind: 'set', setId, data: { event_id: eventId }, edits });
const doneOp = (id, exerciseId, eventId) => ({ id, kind: 'material', optimistic: 'done', exerciseId, data: { event_id: eventId } });
const undoOp = (id, changeId) => ({ id, kind: 'material', url: '/workout-logs/l/undo', data: { event_id: `u-${id}`, change_id: changeId }, undoOf: { change_id: changeId } });
test('undo offer: the newest queued change, by its own id; saved Undo when nothing is queued', () => {
  const saved = { change_id: 'saved', kind: 'set', result: { set_id: 's1' } };
  assert.equal(undoOffer([], saved), saved);
  assert.equal(undoOffer([], null), null);
  const offer = undoOffer([setOp('q1', 's2', 'e1', { actual_reps: null }), doneOp('q2', 'ex', 'e2')], saved);
  assert.deepEqual(offer, { change_id: 'e2', kind: 'exercise_done', result: { exercise_id: 'ex' }, pending: true, opId: 'q2', edits: undefined });
  const setOffer = undoOffer([setOp('q1', 's2', 'e1', { actual_reps: null })], saved);
  assert.equal(setOffer.change_id, 'e1');
  assert.deepEqual(setOffer.edits, { actual_reps: null });
  // Notes and adds are not Undo targets; the saved one stands behind them.
  assert.equal(undoOffer([{ id: 'n', kind: 'note', data: {} }], saved), saved);
});
test('undo offer: one queued Undo means nothing more (no double Undo, no older inverse revived)', () => {
  const saved = { change_id: 'saved', kind: 'set', result: { set_id: 's1' } };
  assert.equal(undoOffer([doneOp('q2', 'ex', 'e2'), undoOp('q3', 'e2')], saved), null);
  assert.equal(undoOffer([undoOp('q3', 'saved')], saved), null);
  // A change made after the queued Undo is offered again.
  assert.equal(undoOffer([undoOp('q3', 'saved'), doneOp('q4', 'ex2', 'e4')], saved).change_id, 'e4');
});
test('undo offer: swap targets the swap id; a set on a page-only row waits', () => {
  const swap = { id: 'q', kind: 'substitute', exerciseId: 'o', data: { id: 'sw' }, swap: { activate: true, setIds: ['n1'], replacementId: 'r' } };
  assert.deepEqual(undoableOp(swap), { change_id: 'sw', kind: 'swap', result: { original_log_exercise_id: 'o', replacement_log_exercise_id: 'r' } });
  assert.equal(undoableOp({ ...swap, swap: { activate: false } }), null);
  assert.equal(undoableOp(setOp('q', 'pending-abc', 'e')), null);
  assert.equal(undoableOp(undoOp('q', 'x')), null);
});

// Pending Finish and skip-rest (LOOK-A-PENDING-FINISH-REVIEW).
const finishOp = (id, eventId, extra = {}) => ({ id, kind: 'complete', method: 'post', url: '/workout-logs/l/finish', data: { event_id: eventId, mode: 'finish' }, ...extra });
test('undo offer: a queued Finish is the Undo target, sent or not; an older /complete is not', () => {
  const saved = { change_id: 'saved', kind: 'set', result: { set_id: 's1' } };
  assert.equal(undoOffer([finishOp('f', 'ef')], saved).kind, 'finish');
  assert.equal(undoOffer([finishOp('f', 'ef')], saved).sent, false);
  assert.equal(undoOffer([finishOp('f', 'ef', { sent: true })], saved).sent, true);
  assert.equal(undoOffer([{ id: 'c', kind: 'complete', url: '/workout-logs/l/complete', data: {} }], saved), saved);
  // The Undo queued behind that Finish ends the offer (no second Undo).
  assert.equal(undoOffer([finishOp('f', 'ef', { sent: true }), undoOp('u', 'ef')], saved), null);
});
test('undo offer: skip the rest names exactly the skipped sets', () => {
  const skip = { id: 'k', kind: 'material', optimistic: 'skip', exerciseId: 'ex', data: { event_id: 'ek', sets: [{ id: 's2', revision: 1 }, { id: 's3', revision: 0 }] } };
  assert.deepEqual(undoableOp(skip), { change_id: 'ek', kind: 'exercise_skip', result: { exercise_id: 'ex', set_ids: ['s2', 's3'] } });
});

// ---------- Home Mark done pointer (LOOK-A-HOME-UNDO-REVIEW) ----------
test('home pointer: both shapes read back; anything else is ignored', async () => {
  const { normalizeHomeUndo, homeUndoIdentity } = await import('../../src/lib/lookA.js');
  const pending = { state: 'pending', source: { workout_assignment_id: 'wa-1' }, event_id: 'e1', workout_name: 'W' };
  assert.deepEqual(normalizeHomeUndo(pending), pending);
  assert.deepEqual(normalizeHomeUndo({ logId: 'l1', change_id: 'c1', workout_name: null }), { state: 'saved', logId: 'l1', change_id: 'c1', workout_name: null });
  assert.deepEqual(normalizeHomeUndo({ state: 'saved', logId: 'l1', change_id: 'c1', undo_event_id: 'u1' }), { state: 'saved', logId: 'l1', change_id: 'c1', workout_name: null, undo_event_id: 'u1' });
  assert.equal(normalizeHomeUndo({ pending: true, source: {}, event_id: 'e1' }), null);
  assert.equal(normalizeHomeUndo({ state: 'pending', event_id: 'e1' }), null);
  assert.equal(normalizeHomeUndo({ state: 'saved', logId: 'l1' }), null);
  assert.equal(homeUndoIdentity(pending), 'pending:e1');
  assert.equal(homeUndoIdentity({ state: 'saved', change_id: 'c1' }), 'saved:c1');
  assert.equal(homeUndoIdentity(null), null);
});

test('home reply: only a log completed now is a completion; Undo only when undoable', async () => {
  const { homeQuickReply } = await import('../../src/lib/lookA.js');
  assert.deepEqual(homeQuickReply({ id: 'l1', status: 'completed', workout_name: 'W', change: { id: 'e1', undoable: true } }),
    { current: true, undo: { state: 'saved', logId: 'l1', change_id: 'e1', workout_name: 'W' } });
  assert.deepEqual(homeQuickReply({ id: 'l1', status: 'completed', change: { id: 'e1', undoable: false } }), { current: true, undo: null });
  assert.deepEqual(homeQuickReply({ id: 'l1', status: 'active', change: { id: 'e1', undoable: true } }), { current: false, undo: null });
  assert.deepEqual(homeQuickReply(null), { current: false, undo: null });
});

test('home pointer swap: replaces only the pointer the operation started from', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  try {
    const { swapHomeUndo, readHomeUndo, storeHomeUndo } = await import('../../src/lib/lookA.js');
    const older = { state: 'saved', logId: 'l1', change_id: 'c1', workout_name: null };
    const newer = { state: 'saved', logId: 'l2', change_id: 'c2', workout_name: null };
    storeHomeUndo(newer);
    assert.equal(swapHomeUndo('saved:c1', null), false);
    assert.deepEqual(readHomeUndo(), newer);
    assert.equal(swapHomeUndo('saved:c2', older), true);
    assert.deepEqual(readHomeUndo(), older);
  } finally { delete globalThis.localStorage; }
});

// Critique fix (port branch): typing into a set that is not logged yet is saved,
// but it is not something to undo.
test('the client Undo is not offered for a typed, not yet logged set; logged and reopened sets keep theirs', () => {
  const log = { exercises: [ex([{ ...set(1), status: 'pending' }, { ...set(2), status: 'completed' }, { ...set(3), status: 'skipped' }])] };
  const offer = (setId) => ({ change_id: 'c', kind: 'set', result: { set_id: setId } });
  assert.equal(clientUndoOffer(offer('s1'), log, new Set()), null);
  assert.equal(clientUndoOffer(offer('s1'), log), null);
  assert.deepEqual(clientUndoOffer(offer('s2'), log, new Set()), offer('s2'));
  assert.deepEqual(clientUndoOffer(offer('s3'), log, new Set()), offer('s3'));
  // The change that reopened a logged set is a real Undo.
  assert.deepEqual(clientUndoOffer(offer('s1'), log, new Set(['s1'])), offer('s1'));
  // Other kinds and unknown sets are left to the server's word.
  for (const kind of ['exercise_done', 'exercise_skip', 'finish', 'swap']) assert.deepEqual(clientUndoOffer({ change_id: 'c', kind }, log, new Set()), { change_id: 'c', kind });
  assert.deepEqual(clientUndoOffer(offer('gone'), log, new Set()), offer('gone'));
  assert.equal(clientUndoOffer(null, log, new Set()), null);
});
