// Normal tracker exercise quick completion (final review 2026-11-12 #5),
// fictional fixtures. Mirrors the rehearsal's semantics: entered values kept,
// true blanks stay blank, prescription never copied, all-or-nothing, grouped
// time-limited Undo that refuses sets changed since.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISE_UNDO_MS, exerciseQuickPlan, exerciseUndoPlan, hasEnteredValues, undoRestTarget } from '../../src/lib/exerciseQuickComplete.js';

// The tracker starts sets with the prescribed load prefilled (revision 0).
const set = (id, n, extra = {}) => ({ id, set_number: n, status: 'pending', actual_load_value: 77.5, actual_load_unit: 'lb', actual_reps: null, actual_rpe: null, revision: 0, ...extra });
const squat = (sets) => ({ id: 'ex_squat', exercise_name: 'Back squat', tracking_type: 'reps_weight', prescribed_load_value: 77.5, prescribed_load_unit: 'lb', prescribed_reps: '5', sets });

test('records 4 reps × 77.5 lb as entered and two untouched sets with no performed values', () => {
  const exercise = squat([set('s1', 1, { actual_reps: '4' }), set('s2', 2), set('s3', 3)]);
  const plan = exerciseQuickPlan(exercise);
  assert.equal(plan.available, true);
  assert.equal(plan.label, 'Record 3 remaining as entered (1 with details, 2 without)');
  assert.deepEqual(plan.entries.map((e) => e.setId), ['s1', 's2', 's3']);
  assert.deepEqual(plan.entries[0].payload, { actual_load_value: 77.5, actual_load_unit: 'lb', actual_reps: 4, actual_rpe: null, status: 'completed' });
  for (const entry of plan.entries.slice(1)) {
    // The prefilled prescription is not a performed value: nothing synthesized.
    assert.deepEqual(entry.payload, { actual_load_value: null, actual_load_unit: null, actual_reps: null, actual_rpe: null, status: 'completed' });
  }
  // Restore reopens each set exactly as it was, prefill included.
  assert.deepEqual(plan.entries[1].restore, { actual_load_value: 77.5, actual_load_unit: 'lb', actual_reps: null, actual_rpe: null, status: 'pending' });
});

test('a typed weight different from the prescription counts as entered; true blanks stay blank', () => {
  const exercise = squat([set('s1', 1, { actual_load_value: '80', actual_reps: '' }), set('s2', 2, { actual_load_value: null, actual_load_unit: null })]);
  const plan = exerciseQuickPlan(exercise);
  assert.equal(plan.withDetails, 1);
  assert.equal(plan.entries[0].payload.actual_load_value, 80);
  assert.equal(plan.entries[0].payload.actual_reps, null);
  assert.equal(plan.entries[1].payload.actual_load_value, null);
  assert.equal(hasEnteredValues(exercise, exercise.sets[1]), false);
});

test('only pending sets of this one exercise are included; completed sets are untouched', () => {
  const exercise = squat([set('s1', 1, { status: 'completed', actual_reps: 5, revision: 2 }), set('s2', 2), set('s3', 3, { status: 'skipped' })]);
  const plan = exerciseQuickPlan(exercise);
  assert.deepEqual(plan.entries.map((e) => e.setId), ['s2']);
  assert.equal(plan.label, 'Record 1 remaining as entered (0 with details, 1 without)');
});

test('refuses when nothing remains, when finished (sealed), on an open conflict, or on an invalid entry — all or nothing', () => {
  assert.equal(exerciseQuickPlan(squat([set('s1', 1, { status: 'completed' })])).available, false);
  assert.equal(exerciseQuickPlan(squat([set('s1', 1)]), { sealed: true }).available, false);
  const conflicted = exerciseQuickPlan(squat([set('s1', 1), set('s2', 2)]), { conflicts: [{ workout_log_set_id: 's2', status: 'open' }] });
  assert.equal(conflicted.available, false);
  assert.match(conflicted.reason, /Set 2 has a disagreement/);
  assert.equal(exerciseQuickPlan(squat([set('s1', 1)]), { conflicts: [{ workout_log_set_id: 's1', status: 'resolved' }] }).available, true);
  const invalid = exerciseQuickPlan(squat([set('s1', 1, { actual_reps: '4' }), set('s2', 2, { actual_reps: '2.5' })]));
  assert.equal(invalid.available, false);
  assert.equal(invalid.invalidSetId, 's2');
  assert.deepEqual(invalid.entries, []);
});

test('duration/distance exercises keep entered metrics and never get reps', () => {
  const plank = { id: 'ex_plank', exercise_name: 'Plank', tracking_type: 'duration', prescribed_duration_value: 30, prescribed_duration_unit: 's', prescribed_load_value: null, sets: [
    { id: 'p1', set_number: 1, status: 'pending', actual_load_value: null, actual_reps: null, actual_rpe: null, actual_duration_value: '45', actual_duration_unit: 's', revision: 0 },
    { id: 'p2', set_number: 2, status: 'pending', actual_load_value: null, actual_reps: null, actual_rpe: null, actual_duration_value: null, actual_duration_unit: null, revision: 0 },
  ] };
  const plan = exerciseQuickPlan(plank);
  assert.equal(plan.withDetails, 1);
  assert.equal(plan.entries[0].payload.actual_duration_value, 45);
  assert.equal(plan.entries[1].payload.actual_duration_value, null);
  assert.equal(plan.entries[1].payload.actual_reps, null);
});

test('grouped Undo restores every set, only within the window, and refuses sets changed since', () => {
  const before = squat([set('s1', 1, { actual_reps: '4' }), set('s2', 2), set('s3', 3)]);
  const plan = exerciseQuickPlan(before);
  const record = { exerciseId: 'ex_squat', entries: plan.entries, expiresMs: 1000 + EXERCISE_UNDO_MS };
  const after = squat(before.sets.map((row, index) => ({ ...row, ...plan.entries[index].payload, revision: 1 })));
  const undo = exerciseUndoPlan(record, after, { nowMs: 2000 });
  assert.equal(undo.available, true);
  assert.deepEqual(undo.entries.map((e) => e.payload.status), ['pending', 'pending', 'pending']);
  assert.equal(undo.entries[0].payload.actual_reps, 4);
  assert.equal(undo.entries[1].payload.actual_load_value, 77.5);
  assert.equal(EXERCISE_UNDO_MS, 6000);
  assert.equal(exerciseUndoPlan(record, after, { nowMs: 1000 + EXERCISE_UNDO_MS }).available, false);
  assert.equal(exerciseUndoPlan(record, after, { nowMs: 2000, sealed: true }).available, false);
  const edited = squat(after.sets.map((row) => (row.id === 's2' ? { ...row, actual_reps: 6 } : row)));
  assert.equal(exerciseUndoPlan(record, edited, { nowMs: 2000 }).available, false);
  const reopened = squat(after.sets.map((row) => (row.id === 's3' ? { ...row, status: 'pending' } : row)));
  assert.equal(exerciseUndoPlan(record, reopened, { nowMs: 2000 }).available, false);
});

// Full previous-state Undo (owner decision 2026-11-12: "Undo restores
// everything as it was, skipped sets included"). Mixed fixture: a completed
// set, two pending sets (one being typed into), and a skipped set.
const mixed = () => squat([
  set('m1', 1, { status: 'completed', actual_reps: 5, revision: 3 }),
  set('m2', 2, { actual_reps: '4', revision: 1 }),
  set('m3', 3),
  set('m4', 4, { status: 'skipped', actual_load_value: null, actual_load_unit: null, revision: 2 }),
]);

test('full Undo on a mixed exercise: pending sets reopen with their values and draft markers; completed and skipped sets are untouched', () => {
  const before = mixed();
  const plan = exerciseQuickPlan(before, { draftIds: new Set(['m2', 'elsewhere']) });
  assert.deepEqual(plan.entries.map((e) => [e.setId, e.draft]), [['m2', true], ['m3', false]]);
  const record = { exerciseId: 'ex_squat', entries: plan.entries, expiresMs: 1000 + EXERCISE_UNDO_MS, restBefore: null, restAfter: 91_000, restStarts: 4 };
  const done = new Map(plan.entries.map((entry) => [entry.setId, entry.payload]));
  const after = squat(before.sets.map((row) => (done.has(row.id) ? { ...row, ...done.get(row.id), revision: row.revision + 1 } : row)));
  const undo = exerciseUndoPlan(record, after, { nowMs: 2000, rest: { endsAt: 91_000, starts: 4 } });
  assert.equal(undo.available, true);
  // Only the sets the action changed are written; the completed and skipped sets get no write.
  assert.deepEqual(undo.entries.map((e) => e.setId), ['m2', 'm3']);
  assert.deepEqual(undo.entries[0].payload, { actual_load_value: 77.5, actual_load_unit: 'lb', actual_reps: 4, actual_rpe: null, status: 'pending' });
  assert.deepEqual(undo.entries[1].payload, { actual_load_value: 77.5, actual_load_unit: 'lb', actual_reps: null, actual_rpe: null, status: 'pending' });
  assert.deepEqual(undo.draftIds, ['m2']);
  // Applying the restore gives back exactly the sets as they were (revisions are the server's and move on).
  const restored = new Map(undo.entries.map((entry) => [entry.setId, entry.payload]));
  const reverted = after.sets.map((row) => (restored.has(row.id) ? { ...row, ...restored.get(row.id) } : row));
  const strip = (row) => { const copy = { ...row, actual_reps: row.actual_reps == null ? null : Number(row.actual_reps) }; delete copy.revision; return copy; };
  assert.deepEqual(reverted.map(strip), before.sets.map(strip));
  assert.deepEqual(reverted[0], before.sets[0], 'completed set byte-equal');
  assert.deepEqual(reverted[3], before.sets[3], 'skipped set byte-equal');
});

test('rest timer: the prior deadline comes back unless a newer timer was started since; adjusting or ending the action\'s own timer does not block it', () => {
  const base = { entries: [], expiresMs: 10_000, restBefore: 50_000, restAfter: 95_000, restStarts: 7 };
  // No timer started since the action: the prior deadline comes back as it was, never restarted or extended.
  assert.deepEqual(undoRestTarget(base, { endsAt: 95_000, starts: 7 }), { apply: true, endsAt: 50_000 });
  // The action's own timer adjusted (+15 s) or ended afterwards is still the action's timer: it is replaced by the prior one.
  assert.deepEqual(undoRestTarget(base, { endsAt: 110_000, starts: 7 }), { apply: true, endsAt: 50_000 });
  assert.deepEqual(undoRestTarget(base, { endsAt: null, starts: 7 }), { apply: true, endsAt: 50_000 });
  // A prior deadline that has already passed is restored as passed (the timer reads as finished, as it would have).
  assert.deepEqual(undoRestTarget({ ...base, restBefore: 1_000 }, { endsAt: 95_000, starts: 7 }), { apply: true, endsAt: 1_000 });
  // No timer before the action: Undo clears the one the action started.
  assert.deepEqual(undoRestTarget({ ...base, restBefore: null }, { endsAt: 95_000, starts: 7 }), { apply: true, endsAt: null });
  // A newer timer was started after the action (another set, or Start rest): that newer timer stays.
  assert.deepEqual(undoRestTarget(base, { endsAt: 140_000, starts: 8 }), { apply: false, endsAt: 140_000 });
  // A record without timer details never touches the timer.
  assert.deepEqual(undoRestTarget({ entries: [], expiresMs: 1 }, { endsAt: 5, starts: 1 }), { apply: false, endsAt: 5 });
});

test('full Undo keeps the safeguards: expired, sealed, stale or already-used Undo writes nothing and restores nothing', () => {
  const before = mixed();
  const plan = exerciseQuickPlan(before, { draftIds: new Set(['m2']) });
  const record = { exerciseId: 'ex_squat', entries: plan.entries, expiresMs: 1000 + EXERCISE_UNDO_MS, restBefore: null, restAfter: 91_000, restStarts: 4 };
  const done = new Map(plan.entries.map((entry) => [entry.setId, entry.payload]));
  const after = squat(before.sets.map((row) => (done.has(row.id) ? { ...row, ...done.get(row.id) } : row)));
  const rest = { endsAt: 91_000, starts: 4 };
  for (const refused of [
    exerciseUndoPlan(record, after, { nowMs: 1000 + EXERCISE_UNDO_MS, rest }),
    exerciseUndoPlan(record, after, { nowMs: 2000, sealed: true, rest }),
    exerciseUndoPlan(record, squat(after.sets.map((row) => (row.id === 'm3' ? { ...row, actual_reps: 6 } : row))), { nowMs: 2000, rest }),
    exerciseUndoPlan({ ...record, used: true }, after, { nowMs: 2000, rest }),
  ]) {
    assert.equal(refused.available, false);
    assert.deepEqual(refused.entries, []);
    assert.deepEqual(refused.draftIds, []);
    assert.equal(refused.rest.apply, false);
  }
});

test('a set Undo returned to its untouched prescribed prefill still counts as untouched: the prescription is never later recorded as performed', async () => {
  const { withRestoredPrefill } = await import('../../src/lib/exerciseQuickComplete.js');
  const before = mixed();
  const plan = exerciseQuickPlan(before);
  assert.deepEqual(plan.entries.map((e) => [e.setId, e.prefill]), [['m2', false], ['m3', true]]);
  const record = { exerciseId: 'ex_squat', entries: plan.entries, expiresMs: 1000 + EXERCISE_UNDO_MS };
  const done = new Map(plan.entries.map((entry) => [entry.setId, entry.payload]));
  const after = squat(before.sets.map((row) => (done.has(row.id) ? { ...row, ...done.get(row.id), revision: row.revision + 1 } : row)));
  const undo = exerciseUndoPlan(record, after, { nowMs: 2000 });
  assert.deepEqual(undo.prefillIds, ['m3']);
  // The server copy after Undo: the prefill load is back, but the revision moved on (history is not rewritten).
  const restored = new Map(undo.entries.map((entry) => [entry.setId, entry.payload]));
  const reopened = squat(after.sets.map((row) => (restored.has(row.id) ? { ...row, ...restored.get(row.id), revision: row.revision + 1 } : row)));
  // Without the device's marker the prefill would read as the person's own entry.
  assert.equal(exerciseQuickPlan(reopened).label, 'Record 2 remaining as entered (2 with details, 0 without)');
  // With it, the set is the untouched prefill again: same label as before, and the prescription is not recorded.
  // The marker is bound to the revision the server acknowledged for the Undo write (independent finding 01).
  const marked = withRestoredPrefill(reopened, { m3: { revision: reopened.sets[2].revision } });
  const again = exerciseQuickPlan(marked);
  assert.equal(again.label, plan.label);
  assert.equal(again.entries[1].payload.actual_load_value, null);
  assert.equal(again.entries[1].prefill, true);
  // Anything typed into that set since makes it the person's entry again.
  const typed = squat(reopened.sets.map((row) => (row.id === 'm3' ? { ...row, actual_reps: '6' } : row)));
  assert.equal(hasEnteredValues(typed, withRestoredPrefill(typed, { m3: { revision: reopened.sets[2].revision } }).sets[2]), true);
  // A completed set is never re-labelled, and no marker means no change.
  assert.equal(withRestoredPrefill(after, { m3: { revision: after.sets[2].revision } }), after);
  assert.equal(withRestoredPrefill(reopened, {}), reopened);
});

// Independent finding 01 (2026-11-12): the marker must never outlive the exact
// state Undo wrote. A newer revision already fetched from the server (another
// device or the coach saved a performed weight) is newer input and must keep
// its value.
test('a newer saved revision of a restored set is the person\'s entry: its explicitly saved weight is kept, not stripped as prefill', async () => {
  const { withRestoredPrefill } = await import('../../src/lib/exerciseQuickComplete.js');
  const prefill = squat([set('n1', 1, { revision: 2 })]);
  // Undo acknowledged at revision 2: still the untouched prefill.
  assert.equal(exerciseQuickPlan(withRestoredPrefill(prefill, { n1: { revision: 2 } })).entries[0].payload.actual_load_value, null);
  // Someone explicitly saved the prescribed weight with blank reps (revision 3), and this device has fetched it.
  const newer = squat([set('n1', 1, { actual_load_value: 77.5, revision: 3, last_actor_role: 'coach' })]);
  const plan = exerciseQuickPlan(withRestoredPrefill(newer, { n1: { revision: 2 } }));
  assert.equal(plan.entries[0].payload.actual_load_value, 77.5);
  assert.equal(plan.entries[0].prefill, false);
  assert.equal(plan.withDetails, 1);
});

test('restored-prefill marker lifecycle: valid only at the revision Undo wrote, before or after its acknowledgement; anything else is ignored', async () => {
  const { withRestoredPrefill, ackPrefillMarker } = await import('../../src/lib/exerciseQuickComplete.js');
  const at = (revision) => squat([set('k1', 1, { revision })]);
  const untouched = (exercise, marker) => withRestoredPrefill(exercise, { k1: marker }).sets[0].revision === 0;
  // Queued (not yet acknowledged, e.g. offline): valid while the set is still at the revision the Undo write was based on.
  const queued = { op: 'q-1', base: 2 };
  assert.equal(untouched(at(2), queued), true);
  assert.equal(untouched(at(3), queued), false, 'a newer server revision fetched before the acknowledgement');
  // Acknowledged: bound to exactly the revision the server returned for that write.
  assert.deepEqual(ackPrefillMarker(queued, { id: 'q-1' }, { revision: 3, event: { outcome: 'applied' } }), { revision: 3 });
  assert.equal(untouched(at(3), { revision: 3 }), true);
  assert.equal(untouched(at(4), { revision: 3 }), false);
  // Another operation's acknowledgement does not bind it; a conflict or a missing revision drops it.
  assert.equal(ackPrefillMarker(queued, { id: 'q-2' }, { revision: 3, event: { outcome: 'applied' } }), queued);
  assert.equal(ackPrefillMarker(queued, { id: 'q-1' }, { revision: 3, event: { outcome: 'conflict' } }), null);
  assert.equal(ackPrefillMarker(queued, { id: 'q-1' }, { event: { outcome: 'applied' } }), null);
  // Superseded 2026-11-12 (Ultra F2): was `{ revision: 3 }`. A replay answers
  // with the CURRENT row, not the state this write produced, so it now retires
  // the marker; safety kept by valueOrigin.test.mjs and the SQL integration check.
  assert.equal(ackPrefillMarker(queued, { id: 'q-1' }, { revision: 3, event: { outcome: 'replayed', original_outcome: 'applied' } }), null);
  assert.equal(ackPrefillMarker(queued, { id: 'q-1' }, { revision: 3, event: { outcome: 'replayed', original_outcome: 'conflict' } }), null);
  // The superseded boolean shape and malformed markers are ignored (fail safe: the values count as entered).
  for (const marker of [true, {}, { revision: '3' }, { op: 'q-1' }, null]) assert.equal(untouched(at(3), marker), false);
  // A set without an integer revision is never treated as untouched by a marker.
  assert.equal(untouched(squat([set('k1', 1, { revision: undefined })]), { revision: 3 }), false);
});

// Independent finding 02 (2026-11-12): this device's own Undo write was
// committed by the server but its acknowledgement has not arrived (held, then a
// reload or refresh fetched the newer revision). Until that acknowledgement
// says whose value the set holds, the restored prescription must be neither
// recorded as performed nor stripped: quick complete waits, with a reason.
test('an unacknowledged own Undo write whose set has moved on gates quick complete until its acknowledgement resolves it', async () => {
  const { prefillMarkerState, unresolvedPrefillSet, withRestoredPrefill, ackPrefillMarker } = await import('../../src/lib/exerciseQuickComplete.js');
  const at = (revision, extra = {}) => squat([set('u0', 1, { status: 'completed', actual_reps: 5, revision: 4 }), set('u1', 2, { revision, ...extra })]);
  const queued = { op: 'q-7', base: 1 };
  const inQueue = (id) => id === 'q-7';
  const gone = () => false;
  // Committed at base+1, acknowledgement still queued: unresolved, not entered, not untouched.
  const fetched = at(2);
  assert.equal(prefillMarkerState(fetched.sets[1], queued, inQueue), 'unresolved');
  assert.deepEqual(unresolvedPrefillSet(fetched, { u1: queued }, inQueue), { setId: 'u1', setNumber: 2, queued: true });
  const gated = exerciseQuickPlan(withRestoredPrefill(fetched, { u1: queued }), { unresolved: unresolvedPrefillSet(fetched, { u1: queued }, inQueue) });
  assert.equal(gated.available, false);
  assert.deepEqual(gated.entries, []);
  assert.match(gated.reason, /^Set 2 is still confirming your Undo\./);
  // "Same as previous" is not offered for it either (it would record the previous set's values over an unknown one).
  const { repeatPlan } = await import('../../src/lib/workoutGuide.js');
  const view = withRestoredPrefill(fetched, { u1: queued });
  assert.equal(repeatPlan(view, view.sets[1], { drafting: false, conflicts: [] }).available, false);
  const ready = withRestoredPrefill(fetched, { u1: { revision: 2 } });
  assert.equal(repeatPlan(ready, ready.sets[1], { drafting: false, conflicts: [] }).available, true, 'control: offered once resolved as untouched');
  // Still at the revision the Undo was based on (not yet applied): untouched, as before.
  const notYet = at(1);
  assert.equal(prefillMarkerState(notYet.sets[1], queued, inQueue), 'untouched');
  assert.equal(unresolvedPrefillSet(notYet, { u1: queued }, inQueue), null);
  assert.equal(exerciseQuickPlan(withRestoredPrefill(notYet, { u1: queued })).entries[0].payload.actual_load_value, null);
  // Acknowledged as applied at revision 2: the gate lifts and the prescription is still not recorded.
  // Superseded 2026-11-12 (Ultra F2): this used a replayed reply. A replay now
  // retires the marker (the set is then gated as a load nobody can attribute,
  // never stripped); the gate-lifting path is a fresh applied reply.
  const retired = ackPrefillMarker(queued, { id: 'q-7' }, { revision: 2, event: { outcome: 'replayed', original_outcome: 'applied' } });
  assert.equal(retired, null);
  assert.equal(prefillMarkerState(fetched.sets[1], retired, gone), 'none');
  const bound = ackPrefillMarker(queued, { id: 'q-7' }, { revision: 2, event: { outcome: 'applied' } });
  assert.equal(prefillMarkerState(fetched.sets[1], bound, gone), 'untouched');
  assert.equal(unresolvedPrefillSet(fetched, { u1: bound }, gone), null);
  const after = exerciseQuickPlan(withRestoredPrefill(fetched, { u1: bound }), { unresolved: null });
  assert.equal(after.available, true);
  assert.equal(after.entries[0].payload.actual_load_value, null);
  // Acknowledged as a conflict: the set holds someone else's newer value, which is kept (not stripped).
  const other = at(2, { actual_load_value: 55, last_actor_role: 'coach' });
  assert.equal(ackPrefillMarker(queued, { id: 'q-7' }, { revision: 2, event: { outcome: 'replayed', original_outcome: 'conflict' } }), null);
  assert.equal(prefillMarkerState(other.sets[1], undefined, gone), 'none');
  assert.equal(exerciseQuickPlan(other).entries[0].payload.actual_load_value, 55);
  // A newer revision after binding is newer input (finding 01 unchanged).
  assert.equal(prefillMarkerState(at(3).sets[1], bound, gone), 'none');
});

test('an Undo marker whose operation is no longer queued and whose set moved on is unresolved with a recovery reason; settled or malformed markers are not', async () => {
  const { prefillMarkerState, unresolvedPrefillSet } = await import('../../src/lib/exerciseQuickComplete.js');
  const at = (revision, extra = {}) => squat([set('o1', 1, { revision, ...extra })]);
  const orphan = { op: 'q-gone', base: 1 };
  const gone = () => false;
  assert.equal(prefillMarkerState(at(2).sets[0], orphan, gone), 'unresolved');
  assert.deepEqual(unresolvedPrefillSet(at(2), { o1: orphan }, gone), { setId: 'o1', setNumber: 1, queued: false });
  const plan = exerciseQuickPlan(at(2), { unresolved: unresolvedPrefillSet(at(2), { o1: orphan }, gone) });
  assert.equal(plan.available, false);
  assert.match(plan.reason, /^Set 1's earlier Undo could not be confirmed\./);
  // Only pending sets can be unresolved; a set at the Undo's base revision is not.
  assert.equal(prefillMarkerState(at(2, { status: 'completed' }).sets[0], orphan, gone), 'none');
  assert.equal(prefillMarkerState(at(1).sets[0], orphan, gone), 'untouched');
  // Bound and malformed markers never gate.
  for (const marker of [{ revision: 2 }, { revision: 1 }, true, {}, null, undefined, { op: 'q-gone' }]) {
    assert.notEqual(prefillMarkerState(at(2).sets[0], marker, gone), 'unresolved');
  }
  // No unresolved set: the plan is unchanged.
  assert.equal(exerciseQuickPlan(at(0), { unresolved: null }).available, true);
});
