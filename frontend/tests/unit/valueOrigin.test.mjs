// Cross-device Undo (local migration 20261113000000): how the tracker reads a
// pending set's value origin. New server rows carry value_origin; old servers
// do not, and then only this device's own markers plus the revision rule are
// used, with unprovable load-only values gated instead of guessed. Fictional
// fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AMBIGUOUS_PREFILL_REASON, ackPrefillMarker, annotateValueViews, exerciseQuickPlan, prefillMarkerState, setValueView, unresolvedPrefillSet,
} from '../../src/lib/exerciseQuickComplete.js';
import { isUntouchedPrefill, repeatPlan } from '../../src/lib/workoutGuide.js';
import { ackedSetFields, mergeRefresh, optimisticSetData } from '../../src/lib/workoutSync.js';

const base = { status: 'pending', actual_load_value: 50, actual_load_unit: 'lb', actual_reps: null, actual_rpe: null };
const press = (sets, extra = {}) => ({ id: 'ex', exercise_name: 'Press', tracking_type: 'reps_weight', prescribed_load_value: 50, prescribed_load_unit: 'lb', sets, ...extra });
const neu = (id, n, origin, extra = {}) => ({ id, set_number: n, ...base, revision: 2, last_actor_role: 'client', value_origin: origin, ...extra });
const old = (id, n, extra = {}) => ({ id, set_number: n, ...base, revision: 0, ...extra });
const view = (exercise, set, opts) => setValueView(exercise, set, opts);

test('new schema: every origin row of the matrix', () => {
  const ex = press([]);
  assert.equal(view(ex, neu('a', 1, 'prefill')), 'untouched');
  assert.equal(view(ex, neu('a', 1, 'prefill', { actual_load_value: 45 })), 'untouched', 'prefill kept after a prescription change');
  assert.equal(view(ex, neu('a', 1, 'entered')), 'entered', 'explicit same value (finding 01)');
  assert.equal(view(ex, neu('a', 1, 'unknown')), 'ambiguous');
  assert.equal(view(ex, neu('a', 1, 'unknown', { actual_reps: 5 })), 'entered');
  assert.equal(view(ex, neu('a', 1, 'unknown', { actual_load_value: null, actual_load_unit: null })), 'entered', 'blank: nothing to invent');
  assert.equal(view(ex, neu('a', 1, 'legacy', { revision: 0, last_actor_role: null })), 'untouched');
  assert.equal(view(ex, neu('a', 1, 'legacy', { revision: 0, last_actor_role: null, actual_load_value: 45 })), 'ambiguous', 'unprovable history is gated');
  assert.equal(view(ex, neu('a', 1, 'legacy', { revision: 3 })), 'ambiguous');
  assert.equal(view(ex, neu('a', 1, 'prefill'), { draft: true }), 'entered', 'a draft is typed input');
  assert.equal(view(ex, neu('a', 1, 'entered', { status: 'completed' })), null);
});

test('old server: own markers first, then the revision rule; cross-device load-only rows are gated', () => {
  const ex = press([]);
  assert.equal(view(ex, old('a', 1)), 'untouched', 'revision 0 prefill (today)');
  assert.equal(view(ex, old('a', 1, { actual_load_value: 55 })), 'entered', 'revision 0 typed load (today)');
  assert.equal(view(ex, old('a', 1, { revision: undefined, actual_load_value: 55 })), 'entered', 'no revision tracking (preview): today');
  assert.equal(view(ex, old('a', 1, { revision: 3 })), 'ambiguous', 'another device or coach at a newer revision');
  assert.equal(view(ex, old('a', 1, { revision: 3, actual_reps: 6 })), 'entered');
  assert.equal(view(ex, old('a', 1, { revision: 3, actual_load_value: null, actual_load_unit: null })), 'entered');
  assert.equal(view(ex, old('a', 1, { revision: 3 }), { marker: { revision: 3 } }), 'untouched', 'own bound Undo marker');
  assert.equal(view(ex, old('a', 1, { revision: 3, actual_load_value: 45 }), { marker: { revision: 3 } }), 'untouched', 'own Undo after a prescription change');
  assert.equal(view(ex, old('a', 1, { revision: 3 }), { marker: { revision: 3, origin: 'entered' } }), 'entered', 'own explicit save (finding 01)');
  assert.equal(view(ex, old('a', 1, { revision: 4 }), { marker: { revision: 3, origin: 'entered' } }), 'ambiguous', 'moved past own save');
  assert.equal(view(ex, old('a', 1, { revision: 2 }), { marker: { op: 'q1', base: 2, origin: 'entered' } }), 'entered', 'own save still queued');
  assert.equal(view(ex, old('a', 1, { revision: 3 }), { marker: { op: 'q1', base: 2 } }), 'unresolved', 'finding 02 gate kept');
});

test('own entered markers never raise the Undo-confirming gate and keep their origin when acknowledged', () => {
  assert.equal(prefillMarkerState(old('a', 1, { revision: 3 }), { op: 'q1', base: 2, origin: 'entered' }), 'none');
  const ex = press([old('a', 1, { revision: 3 })]);
  assert.equal(unresolvedPrefillSet(ex, { a: { op: 'q1', base: 2, origin: 'entered' } }), null);
  assert.deepEqual(ackPrefillMarker({ op: 'q1', base: 2, origin: 'entered' }, { id: 'q1' }, { revision: 3, event: { outcome: 'applied' } }), { revision: 3, origin: 'entered' });
  assert.deepEqual(ackPrefillMarker({ op: 'q1', base: 2 }, { id: 'q1' }, { revision: 3, event: { outcome: 'applied' } }), { revision: 3 });
  assert.equal(ackPrefillMarker({ op: 'q1', base: 2, origin: 'entered' }, { id: 'q1' }, { revision: 3, event: { outcome: 'conflict' } }), null);
});

test('quick complete: untouched prefill (any device) records no weight; ambiguous sets gate with a reason', () => {
  const crossDevice = annotateValueViews(press([neu('a', 1, 'prefill'), neu('b', 2, 'entered', { actual_reps: 5 })]), {});
  const plan = exerciseQuickPlan(crossDevice);
  assert.equal(plan.available, true);
  assert.equal(plan.entries[0].payload.actual_load_value, null, 'never invents 50 lb');
  assert.equal(plan.entries[0].prefill, true);
  assert.equal(plan.entries[1].payload.actual_load_value, 50);
  const changed = annotateValueViews(press([neu('a', 1, 'prefill', { actual_load_value: 45 })], { prescribed_load_value: 60 }), {});
  const changedPlan = exerciseQuickPlan(changed);
  assert.equal(changedPlan.entries[0].payload.actual_load_value, null);
  assert.deepEqual(changedPlan.entries[0].restore, { ...base, actual_load_value: 45 }, 'Undo restores the previous prefill value, not the new prescription');
  const sameValue = exerciseQuickPlan(annotateValueViews(press([neu('a', 1, 'entered')]), {}));
  assert.equal(sameValue.entries[0].payload.actual_load_value, 50, 'finding 01: explicit 50 is recorded');
  const gated = exerciseQuickPlan(annotateValueViews(press([neu('a', 1, 'entered', { actual_reps: 5 }), neu('b', 2, 'unknown')]), {}));
  assert.equal(gated.available, false);
  assert.equal(gated.reason, AMBIGUOUS_PREFILL_REASON(2));
  assert.equal(gated.reason, 'Set 2 may still be the prescribed weight. Record it on its own or enter what you did.');
  assert.deepEqual(gated.entries, []);
  // Recovery: typing makes it a draft (entered), recorded exactly as typed.
  const recovered = exerciseQuickPlan(annotateValueViews(press([neu('a', 1, 'entered', { actual_reps: 5 }), neu('b', 2, 'unknown')]), {}, { draftIds: new Set(['b']) }));
  assert.equal(recovered.available, true);
  assert.equal(recovered.entries[1].payload.actual_load_value, 50);
});

test('the earlier Undo-confirming gate still takes precedence over the ambiguity gate', () => {
  const ex = annotateValueViews(press([old('a', 1, { revision: 3 })]), { a: { op: 'q1', base: 2 } });
  const plan = exerciseQuickPlan(ex, { unresolved: { setId: 'a', setNumber: 1, queued: true } });
  assert.match(plan.reason, /still confirming your Undo/);
});

test('annotated views drive isUntouchedPrefill and Same as previous', () => {
  const ex = annotateValueViews(press([neu('d', 1, 'entered', { status: 'completed', actual_reps: 5 }), neu('a', 2, 'prefill', { actual_load_value: 45 }), neu('b', 3, 'unknown')]), {});
  assert.equal(isUntouchedPrefill(ex, ex.sets[1]), true);
  assert.equal(isUntouchedPrefill(ex, ex.sets[2]), false);
  assert.equal(repeatPlan(ex, ex.sets[1]).available, true);
  assert.equal(repeatPlan(ex, ex.sets[2]).available, false, 'an unproven load is not overwritten by repeat');
  // Without annotations the original rule is unchanged.
  assert.equal(isUntouchedPrefill(press([]), old('a', 1)), true);
  assert.equal(isUntouchedPrefill(press([]), old('a', 1, { revision: 1 })), false);
});

test('optimistic writes never fake the new schema; acknowledgements adopt the server origin', () => {
  assert.deepEqual(optimisticSetData(old('a', 1), { actual_reps: 5, value_origin: 'entered', event_id: 'e' }), { actual_reps: 5, event_id: 'e' });
  assert.deepEqual(optimisticSetData(neu('a', 1, 'prefill'), { actual_reps: 5, value_origin: 'entered' }), { actual_reps: 5, value_origin: 'entered' });
  assert.deepEqual(ackedSetFields({ revision: 4, last_actor_role: 'client', completed_plan_revision: null, value_origin: 'unknown' }), { revision: 4, last_actor_role: 'client', completed_plan_revision: null, value_origin: 'unknown' });
  assert.deepEqual(ackedSetFields({ revision: 4, last_actor_role: 'client', completed_plan_revision: null }), { revision: 4, last_actor_role: 'client', completed_plan_revision: null });
});

test('refresh keeps a draft set\'s local origin with its typed values', () => {
  const local = { exercises: [press([neu('a', 1, 'entered', { actual_load_value: 55, revision: 2 })])] };
  const server = { exercises: [press([neu('a', 1, 'prefill', { revision: 3 })])] };
  const merged = mergeRefresh(local, server, new Set(['a']));
  assert.equal(merged.exercises[0].sets[0].value_origin, 'entered');
  assert.equal(merged.exercises[0].sets[0].actual_load_value, 55);
  const oldLocal = { exercises: [press([old('a', 1, { actual_load_value: 55 })])] };
  const oldServer = { exercises: [press([old('a', 1, { revision: 1 })])] };
  assert.equal(Object.hasOwn(mergeRefresh(oldLocal, oldServer, new Set(['a'])).exercises[0].sets[0], 'value_origin'), false);
});

// Ultra F1/F2 (2026-11-12). F1: a legacy no-event write changes the value and
// updated_at but not revision or last_event_id, so a marker bound to a revision
// alone cannot prove the row is still this device's write. F2: a replayed
// acknowledgement returns the CURRENT row, which may be another device's newer
// value, not the state the original write produced.
const T2 = '2026-11-12T10:00:00.123456+00:00';
const T3 = '2026-11-12T10:00:01.5+00:00';

test('F2: a replayed acknowledgement never binds a marker; only a fresh applied reply binds, with its row stamp', () => {
  for (const marker of [{ op: 'u', base: 1 }, { op: 'u', base: 1, origin: 'entered' }]) {
    assert.equal(ackPrefillMarker(marker, { id: 'u' }, { revision: 3, updated_at: T3, value_origin: 'entered', event: { outcome: 'replayed', original_outcome: 'applied' } }), null);
    assert.equal(ackPrefillMarker(marker, { id: 'u' }, { revision: 3, updated_at: T3, event: { outcome: 'replayed', original_outcome: 'applied' } }), null, 'old server reply shape');
    assert.equal(ackPrefillMarker(marker, { id: 'u' }, { revision: 3, event: { outcome: 'replayed', original_outcome: 'conflict' } }), null);
  }
  assert.deepEqual(ackPrefillMarker({ op: 'u', base: 1 }, { id: 'u' }, { revision: 2, updated_at: T2, event: { outcome: 'applied' } }), { revision: 2, updated_at: T2 });
  assert.deepEqual(ackPrefillMarker({ op: 'u', base: 1, origin: 'entered' }, { id: 'u' }, { revision: 2, updated_at: T2, event: { outcome: 'applied' } }), { revision: 2, updated_at: T2, origin: 'entered' });
  assert.deepEqual(ackPrefillMarker({ op: 'u', base: 1 }, { id: 'u' }, { revision: 2, event: { outcome: 'applied' } }), { revision: 2 }, 'reply without a stamp (synthetic/preview shape)');
});

test('F1 new schema: the server origin is authoritative over this device\'s bound markers', () => {
  const ex = press([]);
  for (const value of [50, 55]) {
    const unknown = neu('a', 1, 'unknown', { revision: 2, actual_load_value: value, updated_at: T3 });
    assert.equal(view(ex, unknown, { marker: { revision: 2, updated_at: T2 } }), 'ambiguous', `legacy ${value} over a stale prefill marker`);
    assert.equal(view(ex, unknown, { marker: { revision: 2 } }), 'ambiguous', `legacy ${value} over an unstamped marker`);
    assert.equal(view(ex, unknown, { marker: { revision: 2, updated_at: T2, origin: 'entered' } }), 'ambiguous', `legacy ${value} over a stale entered marker`);
    const entered = neu('a', 1, 'entered', { revision: 3, actual_load_value: value, last_actor_role: 'coach' });
    assert.equal(view(ex, entered, { marker: { revision: 3 } }), 'entered', `another device's explicit ${value} is never untouched`);
  }
  assert.equal(view(ex, neu('a', 1, 'prefill'), { marker: { revision: 2, origin: 'entered' } }), 'untouched', 'server prefill');
  assert.equal(view(ex, neu('a', 1, 'prefill', { revision: 3 }), { marker: { op: 'u', base: 2 } }), 'unresolved', 'pending-acknowledgement gate kept');
  assert.equal(view(ex, neu('a', 1, 'unknown'), { draft: true }), 'entered', 'drafts unchanged');
  const quick = exerciseQuickPlan(annotateValueViews(press([neu('a', 1, 'unknown', { actual_load_value: 55 })]), { a: { revision: 2 } }));
  assert.equal(quick.available, false);
  assert.equal(quick.reason, AMBIGUOUS_PREFILL_REASON(1));
});

test('F1 old server: a bound marker holds only while the row keeps the stamp its own write produced (same value included)', () => {
  const ex = press([]);
  const own = { revision: 2, updated_at: T2 };
  assert.equal(view(ex, old('a', 1, { revision: 2, updated_at: T2 }), { marker: own }), 'untouched', 'own acknowledged Undo: no false gate');
  assert.equal(view(ex, old('a', 1, { revision: 2, updated_at: '2026-11-12T10:00:00.123456Z' }), { marker: own }), 'untouched', 'same instant, other spelling');
  assert.equal(view(ex, old('a', 1, { revision: 2, updated_at: T3 }), { marker: own }), 'ambiguous', 'legacy same-value 50 write, same revision');
  assert.equal(view(ex, old('a', 1, { revision: 2, updated_at: T3, actual_load_value: 55 }), { marker: own }), 'ambiguous', 'legacy 55 write, same revision');
  assert.equal(view(ex, old('a', 1, { revision: 2, updated_at: '2026-11-12T10:00:00.123457+00:00' }), { marker: own }), 'ambiguous', 'one microsecond later');
  assert.equal(view(ex, old('a', 1, { revision: 2, updated_at: T2 }), { marker: { revision: 2 } }), 'ambiguous', 'unstamped marker against a stamped row (older client storage)');
  assert.equal(view(ex, old('a', 1, { revision: 2 }), { marker: { revision: 2 } }), 'untouched', 'row without a stamp (synthetic/preview): revision rule as before');
  const entered = { revision: 2, updated_at: T2, origin: 'entered' };
  assert.equal(view(ex, old('a', 1, { revision: 2, updated_at: T2 }), { marker: entered }), 'entered', 'own explicit save: no false gate');
  assert.equal(view(ex, old('a', 1, { revision: 2, updated_at: T3, actual_load_value: 60 }), { marker: entered }), 'ambiguous', 'legacy write after own entered save');
  assert.equal(view(ex, old('a', 1, { revision: 2, updated_at: T3, actual_reps: 6 }), { marker: entered }), 'entered', 'performed metrics stay entered');
  assert.equal(prefillMarkerState(old('a', 1, { revision: 2, updated_at: T3 }), own), 'none', 'a stale marker is not the Undo-confirming gate either');
  assert.equal(view(ex, old('a', 1, { revision: 2, updated_at: T3 }), { marker: { op: 'u', base: 2 } }), 'untouched', 'queued own Undo still at its base: unchanged');
});

test('F1/F2 recovery: an own explicit entry after the gate records exactly that value', () => {
  const row = old('a', 1, { revision: 3, updated_at: T3, actual_load_value: 55 });
  const gated = exerciseQuickPlan(annotateValueViews(press([row]), {}));
  assert.equal(gated.available, false);
  const marker = ackPrefillMarker({ op: 'e', base: 3, origin: 'entered' }, { id: 'e' }, { ...row, revision: 4, updated_at: T2, event: { outcome: 'applied' } });
  const saved = { ...row, revision: 4, updated_at: T2 };
  const plan = exerciseQuickPlan(annotateValueViews(press([saved]), { a: marker }));
  assert.equal(plan.available, true);
  assert.equal(plan.entries[0].payload.actual_load_value, 55);
});

test('in session (no reload): the acknowledged row adopts the reply stamp, so an own Undo or save is not falsely gated', () => {
  const ex = press([]);
  const before = old('a', 1, { status: 'completed', revision: 1, actual_load_value: null, actual_load_unit: null, updated_at: '2026-11-12T09:59:00+00:00' });
  const reply = { ...before, status: 'pending', actual_load_value: 50, actual_load_unit: 'lb', revision: 2, updated_at: T2, event: { outcome: 'applied' } };
  const marker = ackPrefillMarker({ op: 'u', base: 1 }, { id: 'u' }, reply);
  const local = { ...before, ...optimisticSetData(before, { status: 'pending', actual_load_value: 50, actual_load_unit: 'lb' }), ...ackedSetFields(reply) };
  assert.equal(local.updated_at, T2);
  assert.equal(view(ex, local, { marker }), 'untouched');
  assert.deepEqual(Object.keys(ackedSetFields({ revision: 2 })).includes('updated_at'), false, 'no stamp in the reply: nothing adopted');
});

test('F2 in session: after a replayed reply the set is held (values on screen may be older than the server\'s) until a refresh', () => {
  const row = neu('a', 1, 'entered', { revision: 3 });
  const held = exerciseQuickPlan(annotateValueViews(press([row]), {}), { unresolved: { setId: 'a', setNumber: 1, checking: true } });
  assert.equal(held.available, false);
  assert.deepEqual(held.entries, []);
  // Mapped (F3, 2026-11-12): was "... Record sets one at a time, or wait a moment.", which invited a
  // per-set write of the stale screen values; the text now only asks to wait.
  assert.equal(held.reason, 'Set 1 is checking for newer saved values. Wait a moment before changing it.');
  assert.equal(exerciseQuickPlan(annotateValueViews(press([row]), {})).available, true, 'control: available once the hold is lifted');
});

// F3 (2026-11-12): the server applies any write from the same actor whatever its base revision, so
// after a replayed reply (the server's CURRENT row) the screen row must not adopt that newer revision
// while it keeps its own values: drafts and later writes stay on the revision their values belong to.
test('F3: a replayed or conflicting reply leaves the screen row (values and revision) as it is; an applied reply is adopted', async () => {
  const { ackedSetRow } = await import('../../src/lib/workoutSync.js');
  const { HELD_SET_REASON } = await import('../../src/lib/exerciseQuickComplete.js');
  const screen = { id: 'a', status: 'pending', actual_load_value: 50, actual_load_unit: 'lb', actual_reps: 9, revision: 1, value_origin: 'prefill', updated_at: T2 };
  const current = { ...screen, actual_load_value: 55, actual_reps: null, revision: 3, value_origin: 'entered', last_actor_role: 'client', updated_at: T3 };
  for (const event of [{ outcome: 'replayed', original_outcome: 'applied' }, { outcome: 'replayed', original_outcome: 'conflict' }, { outcome: 'conflict' }]) {
    assert.equal(ackedSetRow(screen, { ...current, event }), screen, JSON.stringify(event));
  }
  const applied = ackedSetRow(screen, { ...current, revision: 2, event: { outcome: 'applied' } });
  assert.deepEqual([applied.revision, applied.updated_at, applied.value_origin, applied.actual_load_value, applied.actual_reps], [2, T3, 'entered', 50, 9], 'values on screen kept, server fields adopted');
  assert.equal(HELD_SET_REASON(3), 'Set 3 is checking for newer saved values. Wait a moment before changing it.');
  assert.doesNotMatch(HELD_SET_REASON(3), /one at a time|on its own/);
});

// Stale draft (independent review of f284a1e6, 2026-11-12): a refresh kept the WHOLE draft row, so a
// reps-only draft carried the untouched, older weight over another device's newer weight. Drafts now
// keep only the fields the person edited; a same-field change elsewhere is gated for an explicit choice.
test('stale draft: a refresh keeps only the fields the person edited; the rest comes from the server', async () => {
  const sync = await import('../../src/lib/workoutSync.js');
  const local = { exercises: [{ id: 'ex', sets: [{ id: 'a', status: 'pending', actual_load_value: 50, actual_load_unit: 'lb', actual_reps: '9', actual_rpe: null, revision: 1 }] }] };
  const server = { exercises: [{ id: 'ex', sets: [{ id: 'a', status: 'pending', actual_load_value: 55, actual_load_unit: 'lb', actual_reps: null, actual_rpe: null, revision: 3, last_actor_role: 'client' }] }] };
  const edits = new Map([['a', sync.noteDraftEdit(undefined, { actual_reps: null }, 'actual_reps')]]);
  const merged = sync.mergeRefresh(local, server, new Set(['a']), edits).exercises[0].sets[0];
  assert.deepEqual([merged.actual_load_value, merged.actual_load_unit, merged.actual_reps, merged.revision], [55, 'lb', '9', 3]);
  assert.deepEqual([...sync.draftCollisionsIn(local, server, new Set(['a']), edits)], []);
  // A value/unit pair is one edit: typing a weight keeps the unit it was typed in.
  assert.deepEqual(sync.noteDraftEdit(undefined, { actual_load_value: 50, actual_load_unit: 'lb' }, 'actual_load_value'), { actual_load_value: 50, actual_load_unit: 'lb' });
  assert.deepEqual(sync.noteDraftEdit({ actual_reps: null }, { actual_reps: '9' }, 'actual_reps'), { actual_reps: null }, 'the value before the FIRST edit is kept');
  // Without edit records the earlier whole-row behaviour is unchanged (other callers).
  assert.equal(sync.mergeRefresh(local, server, new Set(['a'])).exercises[0].sets[0].actual_load_value, 50);
});

test('stale draft: a same-field change elsewhere is a collision; equal to the start or to the typed value is not', async () => {
  const { draftCollisionsIn } = await import('../../src/lib/workoutSync.js');
  const log = (sets) => ({ exercises: [{ id: 'ex', sets }] });
  const local = log([{ id: 'a', actual_reps: '9', actual_load_value: 50, actual_load_unit: 'lb' }]);
  const edits = new Map([['a', { actual_reps: null }]]);
  const at = (extra) => log([{ id: 'a', actual_reps: null, actual_load_value: 55, actual_load_unit: 'lb', ...extra }]);
  assert.deepEqual([...draftCollisionsIn(local, at({ actual_reps: 8 }), new Set(['a']), edits)], [['a', ['actual_reps']]]);
  assert.deepEqual([...draftCollisionsIn(local, at({}), new Set(['a']), edits)], [], 'unchanged since the edit began');
  assert.deepEqual([...draftCollisionsIn(local, at({ actual_reps: 9 }), new Set(['a']), edits)], [], 'already holds the typed value');
  const loadEdit = new Map([['a', { actual_load_value: 50, actual_load_unit: 'lb' }]]);
  const typed = log([{ id: 'a', actual_load_value: '60.0', actual_load_unit: 'lb' }]);
  assert.deepEqual([...draftCollisionsIn(typed, at({ actual_load_value: 60 }), new Set(['a']), loadEdit)], [], 'numbers compare as numbers');
  assert.deepEqual([...draftCollisionsIn(typed, at({ actual_load_unit: 'kg', actual_load_value: 50 }), new Set(['a']), loadEdit)], [['a', ['actual_load_unit']]], 'pair partner changed elsewhere');
  assert.deepEqual([...draftCollisionsIn(local, at({ actual_reps: 8 }), new Set(), edits)], [], 'not a draft');
});

test('stale draft: quick complete waits for the explicit choice with its own reason', async () => {
  const { CHOICE_SET_REASON } = await import('../../src/lib/exerciseQuickComplete.js');
  const row = neu('a', 1, 'entered', { revision: 3 });
  const plan = exerciseQuickPlan(annotateValueViews(press([row]), {}), { unresolved: { setId: 'a', setNumber: 1, choosing: true } });
  assert.equal(plan.available, false);
  assert.equal(plan.reason, CHOICE_SET_REASON(1));
  assert.equal(CHOICE_SET_REASON(1), 'Set 1 was also changed on another device. Choose which values to keep first.');
});

// F5 (independent review of fb1d7df2, 2026-11-13): a same-set write queued BEFORE a replayed reply was
// sent with its whole stale row. After a replay, queued same-set writes are re-checked against the
// server's current row before dispatch.
const f5Row = { id: 'a', status: 'pending', actual_load_value: 55, actual_load_unit: 'lb', actual_reps: null, actual_rpe: null, actual_duration_value: null, actual_duration_unit: null, actual_distance_value: null, actual_distance_unit: null, revision: 3, last_actor_role: 'client' };
const f5Op = (data, edits, extra = {}) => ({ id: 'q2', kind: 'set', setId: 'a', exerciseId: 'ex', attempts: 0, edits,
  data: { status: 'pending', actual_load_value: 50, actual_load_unit: 'lb', actual_reps: 9, actual_rpe: null, actual_duration_value: null, actual_duration_unit: null, actual_distance_value: null, actual_distance_unit: null, value_origin: 'entered', event_id: 'q2', base_revision: 1, local_seq: 7, ...data }, ...extra });

test('F5: a queued value edit keeps its typed fields and takes untouched fields from the server row', async () => {
  const { reconcileQueuedSet } = await import('../../src/lib/workoutSync.js');
  const decision = reconcileQueuedSet(f5Op({}, { actual_reps: null }), f5Row);
  assert.equal(decision.action, 'send');
  assert.deepEqual([decision.data.actual_reps, decision.data.actual_load_value, decision.data.actual_load_unit, decision.data.base_revision], [9, 55, 'lb', 3]);
  assert.deepEqual([decision.data.event_id, decision.data.local_seq, decision.data.value_origin], ['q2', 7, 'entered'], 'the queue entry keeps its own event');
  // status is not the edit: the server's completion state is kept.
  assert.equal(reconcileQueuedSet(f5Op({}, { actual_reps: null }), { ...f5Row, status: 'completed' }).data.status, 'completed');
});

test('F5: a same-field change on the server, or a queued completion whose values differ, waits for a choice', async () => {
  const { reconcileQueuedSet } = await import('../../src/lib/workoutSync.js');
  const reps = reconcileQueuedSet(f5Op({}, { actual_reps: null }), { ...f5Row, actual_reps: 8 });
  assert.deepEqual(reps, { action: 'choose', fields: ['actual_reps'], saved: { actual_reps: 8 }, yours: { actual_reps: 9 } });
  const completion = reconcileQueuedSet(f5Op({ status: 'completed', actual_reps: null }, { status: 'pending' }), f5Row);
  assert.deepEqual(completion, { action: 'choose', fields: ['actual_load_value'], saved: { actual_load_value: 55 }, yours: { actual_load_value: 50 } });
  const unknown = reconcileQueuedSet(f5Op({ actual_reps: null }, undefined), f5Row);
  assert.equal(unknown.action, 'choose', 'no edit record: never guess which fields were meant');
  const same = reconcileQueuedSet(f5Op({ status: 'completed', actual_load_value: 55, actual_reps: null }, { status: 'pending' }), f5Row);
  assert.deepEqual([same.action, same.data.status, same.data.base_revision], ['send', 'completed', 3]);
  assert.deepEqual(reconcileQueuedSet({ id: 'r', kind: 'archive', setId: 'a', data: {} }, f5Row), { action: 'send', data: {} });
});

test('F5: the explicit choice sends mine or the saved values; saved that changes nothing is dropped', async () => {
  const { resolveQueuedChoice } = await import('../../src/lib/workoutSync.js');
  const op = f5Op({}, { actual_reps: null });
  const row = { ...f5Row, actual_reps: 8 };
  const mine = resolveQueuedChoice(op, row, ['actual_reps'], 'mine');
  assert.deepEqual([mine.action, mine.data.actual_reps, mine.data.actual_load_value, mine.data.base_revision], ['send', 9, 55, 3]);
  assert.deepEqual(resolveQueuedChoice(op, row, ['actual_reps'], 'saved'), { action: 'drop' });
  const completion = f5Op({ status: 'completed', actual_reps: null }, { status: 'pending' });
  const saved = resolveQueuedChoice(completion, f5Row, ['actual_load_value'], 'saved');
  assert.deepEqual([saved.action, saved.data.status, saved.data.actual_load_value, saved.data.base_revision], ['send', 'completed', 55, 3]);
});

test('F5: a replay marks queued same-set writes for a re-check; parked writes hold their set and any Finish', async () => {
  const { markRecheck, nextSendable, replyRow } = await import('../../src/lib/workoutSync.js');
  const queue = [{ id: '1', kind: 'set', setId: 'a' }, { id: '2', kind: 'set', setId: 'b' }, { id: '3', kind: 'archive', setId: 'a' }, { id: '4', kind: 'note', exerciseId: 'ex' }];
  const marked = markRecheck(queue, 'a');
  assert.deepEqual(marked.map((op) => Boolean(op.recheck)), [true, false, true, false]);
  assert.equal(marked[1], queue[1], 'other entries untouched');
  const parked = [{ id: '1', kind: 'set', setId: 'a', parked: true }, { id: '2', kind: 'set', setId: 'a' }, { id: '3', kind: 'set', setId: 'b' }, { id: '4', kind: 'complete' }];
  assert.equal(nextSendable(parked).id, '3', 'later writes for the parked set wait; another set is sent');
  assert.equal(nextSendable([parked[0], parked[3]]), null, 'Finish waits for a parked write');
  assert.equal(nextSendable([{ id: '9', kind: 'complete' }]).id, '9');
  assert.equal(replyRow({ ...f5Row, event: { outcome: 'replayed' } }).actual_load_value, 55);
  assert.equal(replyRow({ event: { outcome: 'replayed' } }), null, 'a reply without the row cannot be used');
});
