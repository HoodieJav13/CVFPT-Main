// pt-session-events/v1 pure rules (L12/CONTRACT.md): request envelopes,
// substitution policy and the bounded catalog suggestions.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  setEventEnvelope, normalizeTargets, substitutionRequest, substitutionPolicy, rankSuggestions,
} = require('../src/lib/sessionEvents');

const EVENT = '11111111-1111-4111-8111-111111111111';

test('set envelope is opt-in, validated, and strips contract fields from the set body', () => {
  assert.equal(setEventEnvelope({ status: 'completed' }), null);
  assert.throws(() => setEventEnvelope({ event_id: 'nope' }), /valid event_id/);
  assert.throws(() => setEventEnvelope({ event_id: EVENT, base_revision: -1 }), /whole number/);
  const envelope = setEventEnvelope({ event_id: EVENT.toUpperCase(), base_revision: 2, local_seq: 7, offline: true, plan_revision_seen: 1, status: 'completed', actual_reps: 8 });
  assert.equal(envelope.eventId, EVENT);
  assert.deepEqual([envelope.baseRevision, envelope.localSeq, envelope.offline, envelope.planRevisionSeen], [2, 7, true, 1]);
  assert.deepEqual(envelope.fields, { status: 'completed', actual_reps: 8 });
});

test('substitute targets stay blank unless given; nothing is inferred', () => {
  assert.deepEqual(normalizeTargets({}), {});
  assert.deepEqual(normalizeTargets({ sets: '', reps: '', load_value: '' }), {});
  assert.deepEqual(normalizeTargets({ sets: 3, reps: '10', load_value: '25', load_unit: 'kg' }), { sets: 3, reps: '10', load_value: 25, load_unit: 'kg' });
  assert.throws(() => normalizeTargets({ load_value: 20, load_unit: 'stone' }), /lb or kg/);
  assert.throws(() => normalizeTargets({ sets: 0 }), /1 to 10/);
});

test('substitution policy: planned backup now, online suggestion asks, offline finishes uninterrupted', () => {
  assert.deepEqual(substitutionPolicy({ source: 'coach_backup', actorRole: 'client', offline: false }), { activate: true, reviewStatus: 'none', notice: 'substitution_used' });
  assert.deepEqual(substitutionPolicy({ source: 'catalog_suggestion', actorRole: 'client', offline: false }), { activate: false, reviewStatus: 'none', notice: 'substitution_request' });
  assert.deepEqual(substitutionPolicy({ source: 'catalog_suggestion', actorRole: 'client', offline: true }), { activate: true, reviewStatus: 'pending', notice: 'substitution_offline' });
  assert.deepEqual(substitutionPolicy({ source: 'coach_backup', actorRole: 'client', offline: true }), { activate: true, reviewStatus: 'none', notice: 'substitution_offline' });
  assert.equal(substitutionPolicy({ source: 'catalog_suggestion', actorRole: 'coach', offline: false }).activate, true);
});

test('substitution request validation', () => {
  const base = { id: EVENT, replacement_log_exercise_id: '22222222-2222-4222-8222-222222222222', source: 'catalog_suggestion', exercise_library_id: '33333333-3333-4333-8333-333333333333', trigger: 'equipment_busy' };
  assert.equal(substitutionRequest(base).targets && Object.keys(substitutionRequest(base).targets).length, 0);
  assert.throws(() => substitutionRequest({ ...base, trigger: 'bored' }), /why/);
  assert.throws(() => substitutionRequest({ ...base, source: 'coach_backup' }), /backup id/);
  assert.throws(() => substitutionRequest({ ...base, reason: 'x'.repeat(201) }), /200/);
});

test('suggestions: approved, same muscle/category, transparent rationale, never the original or needs_review', () => {
  const original = { id: 'bench', name: 'Barbell Bench Press', category: 'Strength', primary_muscle: 'Chest', equipment: 'Barbell, Bench' };
  const catalog = [
    original,
    { id: 'db', name: 'DB Bench Press', category: 'Strength', primary_muscle: 'Chest', equipment: 'Dumbbells, Bench', review_status: 'approved' },
    { id: 'push', name: 'Push-up', category: 'Strength', primary_muscle: 'Chest', equipment: 'Bodyweight', review_status: 'approved' },
    { id: 'review', name: 'Weird Press', category: 'Strength', primary_muscle: 'Chest', equipment: '', review_status: 'needs_review' },
    { id: 'hidden', name: 'Hidden Press', category: 'Strength', primary_muscle: 'Chest', equipment: '', review_status: 'approved', hidden: true },
    { id: 'squat', name: 'Goblet Squat', category: 'Strength', primary_muscle: 'Quads', equipment: 'Dumbbell', review_status: 'approved' },
    { id: 'stretch', name: 'Pec Stretch', category: 'Mobility', primary_muscle: 'Hips', equipment: '', review_status: 'approved' },
  ];
  const all = rankSuggestions({ original, catalog });
  assert.deepEqual(all.map((row) => row.id), ['db', 'push'], 'same muscle required when known; category alone is not enough');
  assert.ok(all[0].rationale.includes('Same primary muscle (Chest)'));
  assert.ok(all.every((row) => !/equivalent|safe/i.test(row.rationale.join(' '))));
  const home = rankSuggestions({ original, catalog, availableEquipment: ['Bodyweight'] });
  assert.deepEqual(home.map((row) => row.id), ['push']);
  assert.deepEqual(rankSuggestions({ original, catalog, excludeIds: ['db'] }).map((row) => row.id), ['push']);
  const noMuscle = rankSuggestions({ original: { id: 'x', category: 'Mobility' }, catalog });
  assert.deepEqual(noMuscle.map((row) => row.id), ['stretch'], 'category fallback only without a muscle');
});
