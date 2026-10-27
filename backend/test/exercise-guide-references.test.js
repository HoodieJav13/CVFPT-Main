// Workout exercise demo references (docs/exercise-guides/design.md): explicit
// inherit/override modes on new writes, nullable legacy compatibility, live
// resolution on reads, client allowlists, and the UNCHANGED Quick v1 contract.
// Mounted routes over an in-memory service-role double; SQL behavior (writer,
// clone, import, Quick derivation, committed replay) is covered by
// supabase/tests/exercise_media/05_guides.sql and integration/exercise-guides-local.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { canAccessClient } = require('../src/security/access');
const { normalizeQuickSessionCreate, quickSessionHash, canonicalJson, PRESCRIPTION_FIELDS } = require('../src/lib/quickSessions');

const COACH = '10000000-0000-4000-8000-000000000001';
const CLIENT = '20000000-0000-4000-8000-000000000001';
const LIB = '70000000-0000-4000-8000-000000000001';
const LIB_NO_DEMO = '70000000-0000-4000-8000-000000000002';
const WORKOUT = '50000000-0000-4000-8000-000000000001';
const ASSIGNMENT = '40000000-0000-4000-8000-000000000001';
const LIB_A = 'https://youtu.be/AAAAAAAAAAA';
const LIB_B = 'https://www.youtube.com/watch?v=BBBBBBBBBBB';
const OVERRIDE = 'https://youtu.be/CCCCCCCCCCC';
const LEGACY = 'https://example.com/legacy-demo';

let actor; let tables; let rpcCalls; let rpcHandlers;

function reset() {
  actor = { role: 'coach', coach: { id: COACH } };
  rpcCalls = [];
  rpcHandlers = {
    save_workout: () => ({ data: WORKOUT, error: null }),
    save_workout_with_program_history: () => ({ data: WORKOUT, error: null }),
  };
  tables = {
    clients: [{ id: CLIENT, coach_id: COACH, name: 'Synthetic Client', archived: false }],
    exercise_library: [
      { id: LIB, name: 'Synthetic Goblet Squat', video_url: LIB_A, hidden: false, archived: false, notes: 'coach only' },
      { id: LIB_NO_DEMO, name: 'Synthetic Band Row', video_url: null, hidden: false, archived: false },
    ],
    workouts: [{ id: WORKOUT, coach_id: COACH, client_id: CLIENT, is_template: false, name: 'Synthetic workout', archived: false }],
    workout_exercises: [
      { id: 'we-inherit', workout_id: WORKOUT, exercise_library_id: LIB, custom_name: 'Synthetic Goblet Squat', video_link_mode: 'inherit', video_url: null, position: 0, archived: false, coach_notes: 'private' },
      { id: 'we-override', workout_id: WORKOUT, exercise_library_id: LIB, custom_name: 'Synthetic Goblet Squat', video_link_mode: 'override', video_url: OVERRIDE, position: 1, archived: false },
      { id: 'we-legacy', workout_id: WORKOUT, exercise_library_id: LIB, custom_name: 'Synthetic Goblet Squat', video_link_mode: null, video_url: LEGACY, position: 2, archived: false },
      { id: 'we-legacy-empty', workout_id: WORKOUT, exercise_library_id: LIB_NO_DEMO, custom_name: 'Synthetic Band Row', video_link_mode: null, video_url: null, position: 3, archived: false },
    ],
    workout_assignments: [{ id: ASSIGNMENT, client_id: CLIENT, workout_id: WORKOUT, assignment_mode: 'active', assigned_for: null, notes: null, archived: false, kind: 'assigned', created_at: 't' }],
    workout_assignment_exercise_loads: [],
    program_assignments: [],
    workout_logs: [],
  };
}

function embed(table, select, row) {
  const out = { ...row };
  if (table === 'workouts' && select.includes('client_owner:clients')) {
    const client = tables.clients.find((c) => c.id === row.client_id);
    out.client_owner = client ? { coach_id: client.coach_id } : null;
  }
  if (table === 'workout_assignments' && select.includes('client:clients')) out.client = tables.clients.find((c) => c.id === row.client_id) || null;
  if (table === 'workout_exercises' && select.includes('library_exercise')) {
    out.library_exercise = tables.exercise_library.find((l) => l.id === row.exercise_library_id) || null;
  }
  return out;
}

const dbPath = require.resolve('../src/supabase');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { supabaseAdmin: {
  rpc(name, args) {
    rpcCalls.push({ name, args });
    const handler = rpcHandlers[name];
    if (!handler) return Promise.resolve({ data: null, error: { message: `unexpected rpc ${name}` } });
    return Promise.resolve(handler(args));
  },
  from(table) {
    const filters = []; let select = '*';
    const rows = () => (tables[table] || []).filter((row) => filters.every((f) => f(row))).map((row) => embed(table, select, row));
    const chain = {
      select(value = '*') { select = value; return chain; },
      eq(key, value) { filters.push((row) => row[key] === value); return chain; },
      in(key, values) { filters.push((row) => values.includes(row[key])); return chain; },
      order() { return chain; },
      limit() { return chain; },
      not() { return chain; },
      update() { return chain; },
      maybeSingle() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
      single() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
      then(resolve, reject) { return Promise.resolve({ data: rows(), error: null, count: rows().length }).then(resolve, reject); },
    };
    return chain;
  },
} } };
const authPath = require.resolve('../src/middleware/auth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  requireAuth(req, _res, next) { req.user = actor; next(); },
  requireCoach(req, res, next) { if (['coach', 'admin'].includes(req.user.role)) next(); else res.status(403).json({ error: 'Coach access required' }); },
  requireClient(req, res, next) { if (req.user.role === 'client') next(); else res.status(403).json({ error: 'Client access required' }); },
  requireAdmin(_req, _res, next) { next(); },
  canAccessClient,
} };

const app = express();
app.use(express.json());
app.use('/api/programs', require('../src/routes/programs'));
let server; let base;
test.before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => new Promise((resolve) => server.close(resolve)));

async function call(method, path, body) {
  const res = await fetch(`${base}/api/programs${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
const savedExercises = () => rpcCalls.find((c) => ['save_workout','save_workout_with_program_history'].includes(c.name))?.args.p_exercises;
const newWorkout = (exercises) => ({ name: 'Synthetic template', exercises });

test('new inherit writes store no copied URL and send an explicit mode to the writer', async () => {
  reset();
  const response = await call('POST', '/workouts', newWorkout([{ exercise_library_id: LIB, custom_name: 'Synthetic Goblet Squat', video_link_mode: 'inherit', video_url: '' }]));
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const [row] = savedExercises();
  assert.equal(row.video_link_mode, 'inherit');
  assert.equal(row.video_url, null);
});

test('new override writes keep the explicit safe URL', async () => {
  reset();
  const response = await call('POST', '/workouts', newWorkout([{ exercise_library_id: LIB, custom_name: 'Synthetic Goblet Squat', video_link_mode: 'override', video_url: ` ${OVERRIDE} ` }]));
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const [row] = savedExercises();
  assert.equal(row.video_link_mode, 'override');
  assert.equal(row.video_url, OVERRIDE);
});

test('contradictory or malformed new mode writes are rejected before any RPC', async () => {
  const cases = [
    ['inherit carrying a URL', { exercise_library_id: LIB, video_link_mode: 'inherit', video_url: OVERRIDE }],
    ['inherit on a custom exercise', { custom_name: 'Synthetic custom', video_link_mode: 'inherit', video_url: '' }],
    ['override without a URL', { exercise_library_id: LIB, video_link_mode: 'override', video_url: '' }],
    ['override with an unsafe URL', { exercise_library_id: LIB, video_link_mode: 'override', video_url: 'javascript:alert(1)' }],
    ['unknown mode', { exercise_library_id: LIB, video_link_mode: 'library', video_url: '' }],
    ['non-string mode', { exercise_library_id: LIB, video_link_mode: true, video_url: '' }],
    ['new unclassified link', { exercise_library_id: LIB, video_link_mode: null, video_url: OVERRIDE }],
  ];
  for (const [name, row] of cases) {
    reset();
    const response = await call('POST', '/workouts', newWorkout([row]));
    assert.equal(response.status, 400, `${name}: ${JSON.stringify(response.body)}`);
    assert.equal(rpcCalls.length, 0, name);
  }
});

test('old request shapes without a mode key keep their exact legacy payload', async () => {
  reset();
  const response = await call('POST', '/workouts', newWorkout([{ exercise_library_id: LIB, custom_name: 'Synthetic Goblet Squat', video_url: LEGACY }]));
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const [row] = savedExercises();
  assert.equal('video_link_mode' in row, false);
  assert.equal(row.video_url, LEGACY);
});

test('re-saving an unchanged legacy row preserves it; only a deliberate choice reclassifies it', async () => {
  reset();
  const keep = await call('PUT', `/workouts/${WORKOUT}`, { exercises: [
    { id: 'we-legacy', exercise_library_id: LIB, custom_name: 'Synthetic Goblet Squat', video_link_mode: null, video_url: LEGACY },
    { id: 'we-legacy-empty', exercise_library_id: LIB_NO_DEMO, custom_name: 'Synthetic Band Row', video_link_mode: null, video_url: '' },
  ] });
  assert.equal(keep.status, 200, JSON.stringify(keep.body));
  assert.deepEqual(savedExercises().map((row) => [row.id, row.video_link_mode, row.video_url]), [['we-legacy', null, LEGACY], ['we-legacy-empty', null, null]]);

  reset();
  const changed = await call('PUT', `/workouts/${WORKOUT}`, { exercises: [
    { id: 'we-legacy', exercise_library_id: LIB, custom_name: 'Synthetic Goblet Squat', video_link_mode: null, video_url: OVERRIDE },
  ] });
  assert.equal(changed.status, 400, 'an edited legacy link must be classified');
  assert.equal(rpcCalls.length, 0);

  reset();
  const chosen = await call('PUT', `/workouts/${WORKOUT}`, { exercises: [
    { id: 'we-legacy', exercise_library_id: LIB, custom_name: 'Synthetic Goblet Squat', video_link_mode: 'inherit', video_url: '' },
  ] });
  assert.equal(chosen.status, 200, JSON.stringify(chosen.body));
  assert.deepEqual(savedExercises().map((row) => [row.id, row.video_link_mode, row.video_url]), [['we-legacy', 'inherit', null]]);
});

test('PUT without an exercises list re-sends stored rows with their stored modes untouched', async () => {
  reset();
  const response = await call('PUT', `/workouts/${WORKOUT}`, { name: 'Renamed synthetic workout' });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(savedExercises().map((row) => [row.id, row.video_link_mode, row.video_url]), [
    ['we-inherit', 'inherit', null], ['we-override', 'override', OVERRIDE], ['we-legacy', null, LEGACY], ['we-legacy-empty', null, null],
  ]);
});

test('coach workout reads resolve the current demo live without rewriting rows', async () => {
  reset();
  const before = JSON.stringify(tables.workout_exercises);
  const first = await call('GET', `/workouts/${WORKOUT}`);
  assert.equal(first.status, 200);
  const demos = Object.fromEntries(first.body.exercises.map((row) => [row.id, row.demo]));
  assert.deepEqual(demos['we-inherit'], { kind: 'youtube', url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA', video_id: 'AAAAAAAAAAA', source: 'library', current_guide: true });
  assert.equal(demos['we-override'].source, 'override');
  assert.deepEqual(demos['we-legacy'], { kind: 'external', url: LEGACY, source: 'legacy', current_guide: true });
  assert.equal(demos['we-legacy-empty'], null);
  // A library replacement propagates to inheriting rows only.
  tables.exercise_library[0].video_url = LIB_B;
  const second = await call('GET', `/workouts/${WORKOUT}`);
  const after = Object.fromEntries(second.body.exercises.map((row) => [row.id, row.demo]));
  assert.equal(after['we-inherit'].video_id, 'BBBBBBBBBBB');
  assert.equal(after['we-override'].video_id, 'CCCCCCCCCCC');
  assert.equal(after['we-legacy'].url, LEGACY);
  assert.equal(JSON.stringify(tables.workout_exercises), before, 'reads never write');
});

test('client assigned reads carry the allowlisted demo DTO, never the internal mode', async () => {
  reset();
  actor = { role: 'client', client: { id: CLIENT } };
  rpcHandlers.get_quick_session_completion = () => ({ data: [], error: null });
  const response = await call('GET', '/client/assigned');
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const exercises = response.body.workouts[0].workout.exercises;
  for (const row of exercises) {
    assert.equal('video_link_mode' in row, false);
    assert.equal('coach_notes' in row, false);
    assert.ok('demo' in row);
    if (row.demo) assert.deepEqual(Object.keys(row.demo).filter((k) => !['kind', 'url', 'video_id', 'source', 'current_guide'].includes(k)), []);
  }
  assert.equal(exercises.find((row) => row.id === 'we-inherit').demo.video_id, 'AAAAAAAAAAA');
  assert.equal('notes' in exercises.find((row) => row.id === 'we-inherit').library_exercise, false);
});

// ----- Quick create stays exactly v1 -----------------------------------------
// Pinned from the UNCHANGED released normalizer at baseline f3c063c. Equal old
// input must keep this exact canonical JSON and v1 hash forever.
const GOLDEN = {
  library_inherits: {
    body: { request_id: '30000000-0000-4000-8000-0000000000a1', client_id: CLIENT, assigned_for: '2031-01-01', name: 'Synthetic quick', notes: '', exercises: [{ exercise_library_id: LIB, custom_name: 'Synthetic Goblet Squat', sets: '3', reps: '8' }] },
    canonical: '{"assigned_for":"2031-01-01","client_id":"20000000-0000-4000-8000-000000000001","exercises":[{"client_notes":null,"coach_notes":null,"custom_name":"Synthetic Goblet Squat","default_load_unit":null,"default_load_value":null,"distance_unit":null,"distance_value":null,"duration_unit":null,"duration_value":null,"exercise_library_id":"70000000-0000-4000-8000-000000000001","reps":"8","rest":null,"sets":"3","superset_group":null,"target_rpe":null,"tempo":null,"tracking_type":"reps_weight","video_url":null}],"name":"Synthetic quick","notes":null,"version":1}',
    hash: 'v1:94bda73eb7a917612f4b05a73262c7444ebdea1d98e1ddde59bc1a73fe738fa0',
  },
  library_override: {
    body: { request_id: '30000000-0000-4000-8000-0000000000a2', client_id: CLIENT, assigned_for: '2031-01-01', name: 'Synthetic quick', notes: '', exercises: [{ exercise_library_id: LIB, custom_name: 'Synthetic Goblet Squat', sets: '3', reps: '8', video_url: OVERRIDE }] },
    canonical: '{"assigned_for":"2031-01-01","client_id":"20000000-0000-4000-8000-000000000001","exercises":[{"client_notes":null,"coach_notes":null,"custom_name":"Synthetic Goblet Squat","default_load_unit":null,"default_load_value":null,"distance_unit":null,"distance_value":null,"duration_unit":null,"duration_value":null,"exercise_library_id":"70000000-0000-4000-8000-000000000001","reps":"8","rest":null,"sets":"3","superset_group":null,"target_rpe":null,"tempo":null,"tracking_type":"reps_weight","video_url":"https://youtu.be/CCCCCCCCCCC"}],"name":"Synthetic quick","notes":null,"version":1}',
    hash: 'v1:30cd526fc2211b18089bb8275864d1305e7ed0a95bed816606a455918f3a510d',
  },
  custom_link: {
    body: { request_id: '30000000-0000-4000-8000-0000000000a3', client_id: CLIENT, assigned_for: '2031-01-01', name: '', notes: 'Synthetic', exercises: [{ custom_name: 'Synthetic plank', sets: 2, tracking_type: 'duration', duration_value: 45, duration_unit: 's', video_url: 'https://example.com/synthetic-plank' }] },
    canonical: '{"assigned_for":"2031-01-01","client_id":"20000000-0000-4000-8000-000000000001","exercises":[{"client_notes":null,"coach_notes":null,"custom_name":"Synthetic plank","default_load_unit":null,"default_load_value":null,"distance_unit":null,"distance_value":null,"duration_unit":"s","duration_value":45,"exercise_library_id":null,"reps":null,"rest":null,"sets":"2","superset_group":null,"target_rpe":null,"tempo":null,"tracking_type":"duration","video_url":"https://example.com/synthetic-plank"}],"name":"Quick session · 2031-01-01","notes":"Synthetic","version":1}',
    hash: 'v1:cc5daaa785ae40d217dca17db8948de94e5795fd23e2c2790f9ac06d464ccf80',
  },
};

test('Quick v1 golden vectors: canonical JSON, hash prefix and field set are unchanged', () => {
  assert.deepEqual(PRESCRIPTION_FIELDS, [
    'exercise_library_id', 'custom_name', 'sets', 'reps', 'default_load_value', 'default_load_unit',
    'rest', 'tempo', 'target_rpe', 'client_notes', 'coach_notes', 'video_url', 'superset_group',
    'tracking_type', 'duration_value', 'duration_unit', 'distance_value', 'distance_unit',
  ]);
  for (const [name, vector] of Object.entries(GOLDEN)) {
    const { payload } = normalizeQuickSessionCreate(vector.body, { today: '2031-01-01' });
    assert.equal(canonicalJson(payload), vector.canonical, name);
    assert.equal(quickSessionHash(payload), vector.hash, name);
    for (const row of payload.exercises) assert.equal('video_link_mode' in row, false, name);
  }
});

test('Quick wire schema still rejects a mode key before any RPC', async () => {
  for (const mode of ['inherit', 'override', null]) {
    reset();
    const body = { ...GOLDEN.library_inherits.body, exercises: [{ ...GOLDEN.library_inherits.body.exercises[0], video_link_mode: mode }] };
    const response = await call('POST', '/quick-sessions', body);
    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.match(response.body.error, /video_link_mode/);
    assert.equal(rpcCalls.length, 0);
  }
});

test('Quick create sends only the hashed v1 facts to the RPC (no mode crosses the boundary)', async () => {
  reset();
  rpcHandlers.create_quick_session = () => ({ data: { state: 'created', assignment_id: ASSIGNMENT, workout_id: WORKOUT }, error: null });
  rpcHandlers.get_quick_session_completion = () => ({ data: [], error: null });
  tables.workout_assignments[0] = { ...tables.workout_assignments[0], kind: 'quick', created_by_coach_id: COACH, create_request_id: GOLDEN.library_inherits.body.request_id, create_request_hash: GOLDEN.library_inherits.hash };
  await call('POST', '/quick-sessions', GOLDEN.library_inherits.body);
  const createCall = rpcCalls.find((c) => c.name === 'create_quick_session');
  assert.ok(createCall, 'create RPC called');
  assert.equal(createCall.args.p_hash, GOLDEN.library_inherits.hash);
  assert.deepEqual(Object.keys(createCall.args.p_exercises[0]), PRESCRIPTION_FIELDS);
  assert.equal(createCall.args.p_exercises[0].video_url, null);
});

test('browser Quick projection reproduces the pinned v1 bodies and omits the internal mode', async () => {
  const { projectQuickForm } = await import('../../frontend/src/lib/trainingLibrary.js');
  const { buildQuickSessionBody } = await import('../../frontend/src/lib/quickSessionRequest.js');
  const build = (form, vector) => buildQuickSessionBody(projectQuickForm(form), { requestId: vector.body.request_id, clientId: CLIENT, today: '2031-01-01' });
  const rows = {
    library_inherits: { exercise_library_id: LIB, custom_name: 'Synthetic Goblet Squat', sets: '3', reps: '8', video_link_mode: 'inherit', video_url: '' },
    // A stale library URL left in the row must not freeze into the request.
    library_inherits_stale: { exercise_library_id: LIB, custom_name: 'Synthetic Goblet Squat', sets: '3', reps: '8', video_link_mode: 'inherit', video_url: LIB_A },
    library_override: { exercise_library_id: LIB, custom_name: 'Synthetic Goblet Squat', sets: '3', reps: '8', video_link_mode: 'override', video_url: OVERRIDE },
  };
  for (const [rowName, vectorName] of [['library_inherits', 'library_inherits'], ['library_inherits_stale', 'library_inherits'], ['library_override', 'library_override']]) {
    const vector = GOLDEN[vectorName];
    const body = build({ assigned_for: '2031-01-01', name: 'Synthetic quick', notes: '', exercises: [rows[rowName]] }, vector);
    for (const row of body.exercises) assert.equal('video_link_mode' in row, false, rowName);
    const { payload } = normalizeQuickSessionCreate(body, { today: '2031-01-01' });
    assert.equal(quickSessionHash(payload), vector.hash, rowName);
  }
});

// ----- Workout log hydration (current guide; never part of the snapshot) -----
test('log hydration resolves the current demo per mode and keeps legacy precedence', () => {
  const { resolveExerciseVideos } = require('../src/routes/workoutLogs');
  const logged = [
    { id: 'l-inherit', source_workout_exercise_id: 'we-inherit', exercise_library_id: LIB },
    { id: 'l-override', source_workout_exercise_id: 'we-override', exercise_library_id: LIB },
    { id: 'l-legacy', source_workout_exercise_id: 'we-legacy', exercise_library_id: LIB },
    { id: 'l-legacy-empty', source_workout_exercise_id: 'we-legacy-empty', exercise_library_id: LIB_NO_DEMO },
  ];
  const sources = tables.workout_exercises.map(({ id, video_url, video_link_mode, exercise_library_id }) => ({ id, video_url, video_link_mode, exercise_library_id }));
  const view = (library) => Object.fromEntries(resolveExerciseVideos(logged, sources, library).map((row) => [row.id, [row.video_url, row.demo && row.demo.source, row.demo && (row.demo.video_id || row.demo.url)]]));
  reset();
  assert.deepEqual(view([{ id: LIB, video_url: LIB_A }, { id: LIB_NO_DEMO, video_url: null }]), {
    'l-inherit': [LIB_A, 'library', 'AAAAAAAAAAA'],
    'l-override': [OVERRIDE, 'override', 'CCCCCCCCCCC'],
    'l-legacy': [LEGACY, 'legacy', LEGACY],
    'l-legacy-empty': [null, null, null],
  });
  // Library replacement: inheriting log guides follow; overrides and legacy links stay.
  assert.deepEqual(view([{ id: LIB, video_url: LIB_B }, { id: LIB_NO_DEMO, video_url: LIB_A }]), {
    'l-inherit': [LIB_B, 'library', 'BBBBBBBBBBB'],
    'l-override': [OVERRIDE, 'override', 'CCCCCCCCCCC'],
    'l-legacy': [LEGACY, 'legacy', LEGACY],
    'l-legacy-empty': [LIB_A, 'library', 'AAAAAAAAAAA'],
  });
});

test('log hydration reads the mode column it resolves with', () => {
  const source = require('node:fs').readFileSync(require.resolve('../src/routes/workoutLogs'), 'utf8');
  assert.match(source, /from\('workout_exercises'\)\s*\.select\('id, video_url, video_link_mode, exercise_library_id'\)/);
});

// ----- Program import drafts (both deploy-root copies) ------------------------
for (const [label, load] of [['backend', async () => require('../src/lib/programDraft.cjs')], ['frontend', async () => (await import('../../frontend/src/lib/programDraft.js')).default]]) {
  test(`${label}: import drafts classify per-row links without materializing library URLs`, async () => {
    const draftTools = await load();
    const draft = draftTools.normalizeDraft({
      program: { name: 'Synthetic import', frequency_days: 1 },
      days: [{ day_number: 1, name: 'Day 1', exercises: [
        { name: 'Explicit link', video_url: OVERRIDE },
        { name: 'No link' },
        // A library match supplied by a copy/export must not freeze its URL.
        { name: 'Library match', library_exercise: { name: 'Library match', video_url: LIB_A } },
        { name: 'Explicit inherit', video_link_mode: 'inherit', library_exercise: { video_url: LIB_A } },
        { name: 'Legacy copy', video_link_mode: null, video_url: LEGACY },
      ] }],
    });
    // Drafts keep their existing empty-string convention; the SQL writer stores NULL.
    assert.deepEqual(draft.days[0].exercises.map((row) => [row.name, row.video_link_mode, row.video_url]), [
      ['Explicit link', 'override', OVERRIDE],
      ['No link', 'inherit', ''],
      ['Library match', 'inherit', ''],
      ['Explicit inherit', 'inherit', ''],
      ['Legacy copy', null, LEGACY],
    ]);
    const bad = draftTools.validateDraft({ program: { name: 'Synthetic import', frequency_days: 1 }, import_meta: { source_type: 'paste' }, days: [{ day_number: 1, name: 'Day 1', exercises: [
      { name: 'Contradiction', video_link_mode: 'inherit', video_url: OVERRIDE },
      { name: 'Empty override', video_link_mode: 'override', video_url: '' },
    ] }] });
    assert.equal(bad.valid, false);
    assert.deepEqual(bad.errors.map((e) => e.path), ['days.0.exercises.0.video_link_mode', 'days.0.exercises.1.video_link_mode']);
  });

  test(`${label}: draftFromProgram preserves each row's mode`, async () => {
    const draftTools = await load();
    const draft = draftTools.draftFromProgram({ name: 'Synthetic', frequency_days: 1, days: [{ day_number: 1, workout: { name: 'Day 1', exercises: [
      { custom_name: 'Inherit', video_link_mode: 'inherit', video_url: null, library_exercise: { name: 'Inherit', video_url: LIB_A } },
      { custom_name: 'Override', video_link_mode: 'override', video_url: OVERRIDE, library_exercise: { name: 'Override', video_url: LIB_A } },
      { custom_name: 'Legacy', video_link_mode: null, video_url: LEGACY, library_exercise: { name: 'Legacy', video_url: LIB_A } },
      { custom_name: 'Legacy empty', video_link_mode: null, video_url: null, library_exercise: { name: 'Legacy empty', video_url: LIB_A } },
    ] } }] });
    assert.deepEqual(draft.days[0].exercises.map((row) => [row.name, row.video_link_mode, row.video_url]), [
      ['Inherit', 'inherit', ''], ['Override', 'override', OVERRIDE], ['Legacy', null, LEGACY], ['Legacy empty', null, ''],
    ]);
  });
}
