import test from 'node:test';
import assert from 'node:assert/strict';
import * as cue from '../../src/lib/cueRetry.js';

function fixture() {
  return {
    clients: [{ id: 'c', coach_id: 'coach', archived: false }],
    programs: [{ id: 'p', archived: false }], programDays: [{ id: 'day', program_id: 'p', workout_id: 'w' }],
    programAssignments: [{ id: 'a', client_id: 'c', program_id: 'p', archived: false }],
    workouts: [{ id: 'w', archived: false }],
    workoutExercises: [{ id: 'src', workout_id: 'w', exercise_library_id: 'lib', reps: '8', sets: '1', notes: 'Original instruction' }],
    workoutLogs: [{ id: 'old', client_id: 'c', program_assignment_id: 'a', program_day_id: 'day', status: 'completed', started_at: '2026-01-01T10:00:00Z', completed_at: '2026-01-01T11:00:00Z' }],
    workoutLogExercises: [{ id: 'old-ex', workout_log_id: 'old', source_workout_exercise_id: 'src', exercise_library_id: 'lib', exercise_name: 'Squat' }],
    workoutLogSets: [{ id: 'old-set', workout_log_id: 'old', workout_log_exercise_id: 'old-ex', status: 'completed', actual_reps: 8 }],
    cueRetries: [], cueReceipts: [],
  };
}
const coach = { role: 'coach', profile: { id: 'coach', name: 'Demo coach' } };
const client = { role: 'client', profile: { id: 'c' } };
const context = (s, actor = coach, log = 'old', ex = 'old-ex') => cue.cueContext(s, actor, log, ex);
function create(s, requestId = 'req-1') {
  return cue.mutateCue(s, coach, 'old', 'old-ex', { action: 'create', text: 'Press the floor away.', source_version: context(s).source_version, request_id: requestId });
}
function next(s, id = 'next', src = 'src') {
  s.workoutLogs.push({ ...s.workoutLogs[0], id, status: 'active', started_at: '2099-01-02T10:00:00Z', completed_at: null });
  s.workoutLogExercises.push({ ...s.workoutLogExercises[0], id: `${id}-ex`, workout_log_id: id, source_workout_exercise_id: src });
  s.workoutLogSets.push({ id: `${id}-set`, workout_log_id: id, workout_log_exercise_id: `${id}-ex`, status: 'pending' });
  cue.linkNextCues(s, id);
}
const error = (fn, status) => assert.throws(fn, e => e.status === status);

test('new cue domain exists as a distinct attempt feedback loop', () => {
  assert.equal(typeof cue.mutateCue, 'function');
});
test('cue links next exact-source attempt, client sees it, coach rechecks without changing history', () => {
  const s = fixture();
  const original = structuredClone([s.workoutLogs[0], s.workoutLogExercises[0], s.workoutLogSets[0], s.workoutExercises[0]]);
  const row = create(s);
  assert.equal(row.verdict, 'pending');
  next(s);
  assert.equal(context(s, client, 'next', 'next-ex').incoming[0].text, row.text);
  assert.equal(context(s).outgoing[0].retry_exercise_id, 'next-ex');
  error(() => cue.mutateCue(s, coach, 'next', 'next-ex', { action: 'verdict', cue_id: row.id, revision: row.revision, verdict: 'fixed', request_id: 'v1' }), 409);
  s.workoutLogs[1].status = 'completed'; s.workoutLogSets[1].status = 'completed';
  const saved = cue.mutateCue(s, coach, 'next', 'next-ex', { action: 'verdict', cue_id: row.id, revision: row.revision, verdict: 'fixed', request_id: 'v1' });
  assert.equal(saved.verdict, 'fixed');
  assert.deepEqual([s.workoutLogs[0], s.workoutLogExercises[0], s.workoutLogSets[0], s.workoutExercises[0]], original);
  assert.equal(JSON.parse(JSON.stringify(s)).cueRetries[0].verdict, 'fixed');
});
test('authorization masks wrong client/coach/missing attempts and forbids client writes', () => {
  const s = fixture(); create(s);
  error(() => context(s, { role: 'client', profile: { id: 'other' } }), 404);
  error(() => context(s, { role: 'coach', profile: { id: 'other' } }), 404);
  error(() => context(s, coach, 'missing'), 404);
  error(() => context(s, coach, 'old', 'missing'), 404);
  error(() => cue.mutateCue(s, client, 'old', 'old-ex', { action: 'create' }), 403);
  assert.equal(context(s, client).outgoing.length, 1);
  assert.equal(context(s, { role: 'admin', profile: { id: 'admin' } }).outgoing.length, 1);
});
test('repeat request is idempotent, changed payload and stale revision reject', () => {
  const s = fixture(); const row = create(s);
  assert.deepEqual(create(s), row); assert.equal(s.cueRetries.length, 1);
  error(() => cue.mutateCue(s, coach, 'old', 'old-ex', { action: 'create', text: 'Different', source_version: context(s).source_version, request_id: 'req-1' }), 409);
  error(() => create(s, 'req-2'), 409);
  error(() => cue.mutateCue(s, coach, 'old', 'old-ex', { action: 'edit', cue_id: row.id, revision: 0, text: 'New cue', source_version: context(s).source_version, request_id: 'edit' }), 409);
});
test('edit and soft cancellation before retry preserve receipts; linked text is frozen', () => {
  const s = fixture(); const row = create(s);
  const edited = cue.mutateCue(s, coach, 'old', 'old-ex', { action: 'edit', cue_id: row.id, revision: row.revision, text: 'Slow the descent.', source_version: context(s).source_version, request_id: 'e' });
  assert.equal(edited.text, 'Slow the descent.');
  next(s);
  for (const action of ['edit', 'cancel']) error(() => cue.mutateCue(s, coach, 'old', 'old-ex', { action, cue_id: row.id, revision: edited.revision, text: 'No', source_version: context(s).source_version, request_id: action }), 409);
  const t = fixture(); const other = create(t);
  cue.mutateCue(t, coach, 'old', 'old-ex', { action: 'cancel', cue_id: other.id, revision: other.revision, request_id: 'cancel' });
  next(t); assert.equal(context(t, client, 'next', 'next-ex').incoming.length, 0);
  assert.equal(context(t).outgoing[0].archived, true); assert.equal(t.cueReceipts.length, 2);
});
test('stale plan, missing source, wrong assignment and same-library different source never silently bind', () => {
  const s = fixture(); const token = context(s).source_version;
  s.workoutExercises[0].reps = '12';
  error(() => cue.mutateCue(s, coach, 'old', 'old-ex', { action: 'create', text: 'Cue', source_version: token, request_id: 'x' }), 409);
  create(s); s.workoutExercises[0].reps = '15'; next(s);
  assert.equal(context(s, client, 'next', 'next-ex').incoming.length, 0);
  assert.equal(context(s).outgoing[0].stale, true);
  const t = fixture(); create(t); next(t, 'wrong', 'different-src');
  assert.equal(context(t).outgoing[0].retry_exercise_id, null);
  t.programAssignments[0].archived = true; next(t, 'unassigned');
  assert.equal(context(t).outgoing[0].retry_exercise_id, null);
  t.workoutExercises.length = 0; error(() => create(t, 'new'), 409);
});
test('pending/partial/nochange verdicts, malformed text and no performed retry are handled', () => {
  const s = fixture();
  for (const text of ['', ' ', [], 'x'.repeat(501)]) error(() => cue.mutateCue(s, coach, 'old', 'old-ex', { action: 'create', text, source_version: context(s).source_version, request_id: 'bad' }), 400);
  const row = create(s); next(s); s.workoutLogs[1].status = 'completed';
  error(() => cue.mutateCue(s, coach, 'next', 'next-ex', { action: 'verdict', cue_id: row.id, revision: row.revision, verdict: 'partial', request_id: 'no-performed' }), 409);
  s.workoutLogSets[1].status = 'completed';
  for (const verdict of ['partial', 'nochange', 'pending']) {
    cue.mutateCue(s, coach, 'next', 'next-ex', { action: 'verdict', cue_id: row.id, revision: row.revision, verdict, request_id: verdict });
    assert.equal(row.verdict, verdict);
  }
});


test('one awaiting cue per assigned exercise prevents hidden stacked cues on the next attempt', () => {
  const s = fixture(); create(s);
  s.workoutLogs.push({ ...s.workoutLogs[0], id: 'another-old' });
  s.workoutLogExercises.push({ ...s.workoutLogExercises[0], id: 'another-ex', workout_log_id: 'another-old' });
  s.workoutLogSets.push({ ...s.workoutLogSets[0], id: 'another-set', workout_log_id: 'another-old', workout_log_exercise_id: 'another-ex' });
  error(() => cue.mutateCue(s, coach, 'another-old', 'another-ex', { action: 'create', text: 'Second cue', source_version: context(s, coach, 'another-old', 'another-ex').source_version, request_id: 'another' }), 409);
});

test('a linked retry plan change preserves receipt but refuses a verdict on a different attempt version', () => {
  const s = fixture(); const row = create(s); next(s);
  s.workoutLogs[1].status = 'completed'; s.workoutLogSets[1].status = 'completed';
  s.workoutLogExercises[1].plan_revision = 1;
  s.workoutLogExercises[1].exercise_library_id = 'different-library';
  assert.equal(context(s, client, 'next', 'next-ex').incoming[0].stale_retry, true);
  error(() => cue.mutateCue(s, coach, 'next', 'next-ex', { action: 'verdict', cue_id: row.id, revision: row.revision, verdict: 'fixed', request_id: 'wrong-version' }), 409);
  assert.equal(row.verdict, 'pending');
});
