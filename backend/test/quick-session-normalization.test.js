const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  QUICK_SESSION_HASH_VERSION,
  PRESCRIPTION_FIELDS,
  canonicalJson,
  normalizeQuickSessionCreate,
  quickSessionHash,
  trackingExercises,
} = require('../src/lib/quickSessions');

const REQUEST = '6f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f';
const CLIENT = '11111111-2222-4333-8444-555555555555';
const OTHER_CLIENT = '99999999-2222-4333-8444-555555555555';
const LIBRARY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const TODAY = '2026-10-09';

function body(overrides = {}) {
  return {
    request_id: REQUEST,
    client_id: CLIENT,
    assigned_for: '2026-10-09',
    name: 'Leg day',
    notes: 'Warm up first',
    exercises: [
      { exercise_library_id: LIBRARY, sets: '3', reps: '8', default_load_value: 135, default_load_unit: 'lb', superset_group: 'x' },
      { custom_name: 'Plank', sets: '2', tracking_type: 'duration', duration_value: 45, duration_unit: 's', superset_group: 'x' },
    ],
    ...overrides,
  };
}

const normalize = (value, today = TODAY) => normalizeQuickSessionCreate(value, { today });
const hashOf = (value, today = TODAY) => quickSessionHash(normalize(value, today).payload);
const rejects = (value, pattern) => assert.throws(() => normalize(value), (error) => {
  assert.equal(error.status, 400);
  if (pattern) assert.match(error.message, pattern);
  return true;
});

test('canonical v1 payload holds exactly the allowlisted fields and every persisted prescription field', () => {
  const { request_id: requestId, payload } = normalize(body());
  assert.equal(requestId, REQUEST);
  assert.deepEqual(Object.keys(payload).sort(), ['assigned_for', 'client_id', 'exercises', 'name', 'notes', 'version']);
  assert.equal(payload.version, QUICK_SESSION_HASH_VERSION);
  assert.equal(payload.version, 1);
  assert.deepEqual(PRESCRIPTION_FIELDS, [
    'exercise_library_id', 'custom_name', 'sets', 'reps', 'default_load_value', 'default_load_unit',
    'rest', 'tempo', 'target_rpe', 'client_notes', 'coach_notes', 'video_url', 'superset_group',
    'tracking_type', 'duration_value', 'duration_unit', 'distance_value', 'distance_unit',
  ]);
  for (const row of payload.exercises) assert.deepEqual(Object.keys(row).sort(), [...PRESCRIPTION_FIELDS].sort());
  assert.deepEqual(payload.exercises[0], {
    exercise_library_id: LIBRARY, custom_name: null, sets: '3', reps: '8', default_load_value: 135,
    default_load_unit: 'lb', rest: null, tempo: null, target_rpe: null, client_notes: null, coach_notes: null,
    video_url: null, superset_group: 'A', tracking_type: 'reps_weight', duration_value: null,
    duration_unit: null, distance_value: null, distance_unit: null,
  });
  assert.equal(payload.exercises[1].tracking_type, 'duration');
  assert.equal(payload.exercises[1].duration_value, 45);
  assert.equal(payload.exercises[1].superset_group, 'A');
});

test('hash is v1 plus SHA-256 of recursively key-sorted UTF-8 JSON', () => {
  const { payload } = normalize(body({ name: 'Día · Ñ' }));
  const expected = `v1:${crypto.createHash('sha256').update(Buffer.from(canonicalJson(payload), 'utf8')).digest('hex')}`;
  assert.equal(quickSessionHash(payload), expected);
  assert.match(quickSessionHash(payload), /^v1:[0-9a-f]{64}$/);
  assert.equal(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } }), '{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}');
});

test('equivalent_forms_replay: aliases, numeric forms, defaults, blank rows and superset keys fingerprint equally', () => {
  const base = hashOf(body());
  const equivalent = body({
    request_id: REQUEST.toUpperCase(),
    client_id: CLIENT.toUpperCase(),
    notes: '  Warm up first  ',
    exercises: [
      { custom_name: '', name: '' },
      { exercise_library_id: LIBRARY.toUpperCase(), sets: 3, reps: 8, default_load_value: '135', superset_group: '  pair-1 ' },
      { name: 'Plank', sets: '2', tracking_type: 'duration', duration_value: '45', duration_unit: 's', superset_group: 'pair-1', notes: '' },
      { exercise_library_id: '', custom_name: '   ' },
    ],
  });
  assert.equal(hashOf(equivalent), base);
  // notes alias resolves to client_notes with client_notes taking precedence.
  const aliased = normalize(body({ exercises: [{ custom_name: 'Row', notes: 'Slow' }] })).payload.exercises[0];
  assert.equal(aliased.client_notes, 'Slow');
  const precedence = normalize(body({ exercises: [{ custom_name: 'Row', notes: 'Slow', client_notes: 'Fast' }] })).payload.exercises[0];
  assert.equal(precedence.client_notes, 'Fast');
  assert.equal(hashOf(body({ exercises: [{ custom_name: 'Row', notes: 'Slow' }] })), hashOf(body({ exercises: [{ custom_name: 'Row', client_notes: 'Slow' }] })));
  // name is an alias for custom_name.
  assert.equal(hashOf(body({ exercises: [{ name: 'Row' }] })), hashOf(body({ exercises: [{ custom_name: 'Row' }] })));
  // A load value without a unit defaults to lb; no value means null value and unit.
  const loads = normalize(body({ exercises: [{ custom_name: 'Row', default_load_value: 10 }, { custom_name: 'Row', default_load_unit: 'kg' }] })).payload.exercises;
  assert.deepEqual([loads[0].default_load_value, loads[0].default_load_unit], [10, 'lb']);
  assert.deepEqual([loads[1].default_load_value, loads[1].default_load_unit], [null, null]);
  // Empty text becomes null; visible text is never trimmed or case-folded.
  const text = normalize(body({ exercises: [{ custom_name: '  Squat  ', sets: '', tempo: ' 3-1-1 ' }] })).payload.exercises[0];
  assert.deepEqual([text.custom_name, text.sets, text.tempo], ['  Squat  ', null, ' 3-1-1 ']);
  assert.notEqual(hashOf(body({ exercises: [{ custom_name: 'Squat' }] })), hashOf(body({ exercises: [{ custom_name: 'sQUAT' }] })));
  // A lone superset key is a straight set.
  assert.equal(normalize(body({ exercises: [{ custom_name: 'Row', superset_group: 'solo' }] })).payload.exercises[0].superset_group, null);
});

test('every_prescription_field_is_hashed, reordering and client/date/name/notes changes mismatch', () => {
  const single = (row) => body({ exercises: [{ custom_name: 'Row', ...row }, { custom_name: 'Dip' }] });
  const base = hashOf(single({}));
  const variants = {
    exercise_library_id: { exercise_library_id: LIBRARY },
    custom_name: { custom_name: 'Row 2' },
    sets: { sets: '4' },
    reps: { reps: '12' },
    default_load_value: { default_load_value: 20 },
    default_load_unit: { default_load_value: 20, default_load_unit: 'kg' },
    rest: { rest: '90s' },
    tempo: { tempo: '3-1-1' },
    target_rpe: { target_rpe: '8' },
    client_notes: { client_notes: 'Breathe' },
    coach_notes: { coach_notes: 'Watch knees' },
    video_url: { video_url: 'https://example.test/v' },
    superset_group: { superset_group: 'g' },
    tracking_type: { tracking_type: 'distance' },
    duration_value: { tracking_type: 'duration', duration_value: 30, duration_unit: 's' },
    duration_unit: { tracking_type: 'duration', duration_value: 30, duration_unit: 'min' },
    distance_value: { tracking_type: 'distance', distance_value: 400, distance_unit: 'm' },
    distance_unit: { tracking_type: 'distance', distance_value: 400, distance_unit: 'yd' },
  };
  const seen = new Set([base]);
  for (const field of PRESCRIPTION_FIELDS) {
    assert.ok(variants[field], `variant for ${field}`);
    const extra = field === 'superset_group'
      ? body({ exercises: [{ custom_name: 'Row', superset_group: 'g' }, { custom_name: 'Dip', superset_group: 'g' }] })
      : single(variants[field]);
    const hash = hashOf(extra);
    assert.ok(!seen.has(hash), `${field} changes the fingerprint`);
    seen.add(hash);
  }
  // Paired unit variants differ from their value variants too.
  assert.notEqual(hashOf(single(variants.duration_value)), hashOf(single(variants.duration_unit)));
  assert.notEqual(hashOf(single(variants.distance_value)), hashOf(single(variants.distance_unit)));
  assert.notEqual(hashOf(body({ exercises: [{ custom_name: 'Dip' }, { custom_name: 'Row' }] })), base);
  for (const change of [{ client_id: OTHER_CLIENT }, { assigned_for: '2026-10-10' }, { name: 'Other' }, { notes: 'Other' }]) {
    assert.notEqual(hashOf({ ...single({}), ...change }), base);
  }
  assert.notEqual(hashOf({ ...single({}), notes: '' }), base);
});

test('resolved_defaults_are_frozen: default date is the injected Denver day and title uses it exactly', () => {
  const omitted = body({ assigned_for: undefined, name: '   ' });
  delete omitted.assigned_for;
  const lateNight = normalize(omitted, '2026-10-09').payload;
  assert.equal(lateNight.assigned_for, '2026-10-09');
  assert.equal(lateNight.name, 'Quick session · 2026-10-09');
  const afterMidnight = normalize(omitted, '2026-10-10').payload;
  assert.equal(afterMidnight.name, 'Quick session · 2026-10-10');
  assert.notEqual(quickSessionHash(lateNight), quickSessionHash(afterMidnight));
  // A browser that froze both fields before dispatch replays across midnight.
  const frozen = body({ assigned_for: '2026-10-09', name: 'Quick session · 2026-10-09' });
  assert.equal(hashOf(frozen, '2026-10-10'), quickSessionHash(lateNight));
  assert.equal(normalize(body({ name: '  Pull  ' })).payload.name, 'Pull');
  assert.equal(normalize(body({ notes: '   ' })).payload.notes, null);
  assert.equal(normalize(body({ notes: null })).payload.notes, null);
  assert.throws(() => normalizeQuickSessionCreate(body(), {}), /today/);
});

test('rejects client-controlled actor, hash, template/private flags, ids and unsupported fields', () => {
  for (const field of ['actor', 'created_by_coach_id', 'coach_id', 'create_request_hash', 'hash', 'is_template', 'private',
    'hidden', 'workout_id', 'assignment_id', 'description', 'goal', 'start', 'save_to_library', 'assignment_mode', 'exercise_loads']) {
    rejects(body({ [field]: 'x' }), /not accepted|Unsupported/i);
  }
  rejects(body({ exercises: [{ id: LIBRARY, custom_name: 'Row' }] }), /not accepted|Unsupported/i);
  rejects(body({ exercises: [{ custom_name: 'Row', rest_seconds: 60 }] }), /Unsupported/i);
  rejects(body({ exercises: [{ custom_name: 'Row', library_exercise: {} }] }), /Unsupported/i);
});

test('rejects invalid identifiers, dates, tracking, units, shapes and empty sessions', () => {
  rejects(body({ request_id: 'nope' }), /request/i);
  rejects(body({ request_id: undefined }), /request/i);
  rejects(body({ client_id: 'nope' }), /client/i);
  rejects(body({ assigned_for: '2026-02-30' }), /date/i);
  rejects(body({ assigned_for: '10/09/2026' }), /date/i);
  rejects(body({ assigned_for: 20261009 }), /date/i);
  rejects(body({ name: 7 }), /name|title/i);
  rejects(body({ name: 'x'.repeat(121) }), /name|title/i);
  rejects(body({ notes: {} }), /notes/i);
  rejects(body({ exercises: 'nope' }), /exercise/i);
  rejects(body({ exercises: [] }), /exercise/i);
  rejects(body({ exercises: [{ custom_name: '' }] }), /exercise/i);
  rejects(body({ exercises: Array.from({ length: 51 }, () => ({ custom_name: 'Row' })) }), /exercise/i);
  rejects(body({ exercises: [null] }), /exercise/i);
  rejects(body({ exercises: [{ exercise_library_id: 'nope' }] }), /exercise/i);
  rejects(body({ exercises: [{ custom_name: 'Row', tracking_type: 'swimming' }] }), /tracking/i);
  rejects(body({ exercises: [{ custom_name: 'Row', tracking_type: 'duration', duration_value: 5, duration_unit: 'kg' }] }), /Duration/);
  rejects(body({ exercises: [{ custom_name: 'Row', distance_value: 5, distance_unit: 'm' }] }), /distance/i);
  rejects(body({ exercises: [{ custom_name: 'Row', default_load_value: -1 }] }), /load|weight/i);
  rejects(body({ exercises: [{ custom_name: 'Row', default_load_value: 'heavy' }] }), /load|weight/i);
  rejects(body({ exercises: [{ custom_name: 'Row', default_load_value: 5, default_load_unit: 'stone' }] }), /load|weight/i);
  rejects(body({ exercises: [{ custom_name: 'Row', sets: { n: 3 } }] }), /sets/i);
  rejects(body({ exercises: [{ custom_name: 'Row', sets: true }] }), /sets/i);
  rejects(body({ exercises: [{ custom_name: 'Row', coach_notes: 'x'.repeat(2001) }] }), /coach_notes/i);
  rejects(null, /request/i);
  rejects([], /request/i);
});

test('backend-local trackingExercises keeps the existing create/update merge and superset contract', () => {
  const previous = [{ id: 'we-1', custom_name: 'Run', tracking_type: 'duration', duration_value: 20, duration_unit: 'min' }];
  const [merged] = trackingExercises([{ id: 'we-1', custom_name: 'Run', sets: '2' }], previous);
  assert.deepEqual([merged.tracking_type, merged.duration_value, merged.duration_unit], ['duration', 20, 'min']);
  assert.equal(merged.sets, '2');
  const grouped = trackingExercises([{ custom_name: 'A', superset_group: 'k' }, { custom_name: '' }, { custom_name: 'B', superset_group: 'k' }]);
  assert.deepEqual(grouped.map((row) => row.superset_group), ['A', null, 'A']);
  assert.throws(() => trackingExercises([{ custom_name: 'A', tracking_type: 'swim' }]), (error) => error.status === 400);
});
