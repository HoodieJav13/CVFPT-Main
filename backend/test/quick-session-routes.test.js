// Mounted quick-session routes (A1-A3, A6, A9 route halves) over an in-memory
// service-role double. Real transactional behavior is covered by the SQL suite in
// supabase/tests/quick_sessions; these tests pin the HTTP contract and fences.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { canAccessClient } = require('../src/security/access');
const { normalizeQuickSessionCreate, quickSessionHash } = require('../src/lib/quickSessions');
const { todayDateInTz } = require('../src/utils/time');

const COACH = '10000000-0000-4000-8000-000000000001';
const OTHER_COACH = '10000000-0000-4000-8000-000000000002';
const ADMIN = '10000000-0000-4000-8000-0000000000ad';
const CLIENT = '20000000-0000-4000-8000-000000000001';
const CLIENT_TWO = '20000000-0000-4000-8000-000000000002';
const REQUEST = '30000000-0000-4000-8000-000000000001';
const ASSIGNMENT = '40000000-0000-4000-8000-000000000001';
const WORKOUT = '50000000-0000-4000-8000-000000000001';
const TEMPLATE = '60000000-0000-4000-8000-000000000001';

let actor; let tables; let rpcCalls; let rpcHandlers; let readFailures;

function reset() {
  actor = { role: 'coach', coach: { id: COACH } };
  rpcCalls = [];
  readFailures = new Set();
  rpcHandlers = {};
  tables = {
    clients: [
      { id: CLIENT, coach_id: COACH, name: 'Sarah Fixture', archived: false },
      { id: CLIENT_TWO, coach_id: COACH, name: 'Second Fixture', archived: false },
    ],
    workouts: [{ id: WORKOUT, coach_id: COACH, client_id: CLIENT, is_template: false, name: 'Quick session · 2031-01-01', archived: false }],
    workout_exercises: [{ id: 'we-1', workout_id: WORKOUT, custom_name: 'Plank', position: 0, archived: false }],
    workout_assignments: [{
      id: ASSIGNMENT, client_id: CLIENT, workout_id: WORKOUT, assignment_mode: 'dated', assigned_for: '2031-01-01',
      notes: null, archived: false, created_at: '2031-01-01T00:00:00Z', kind: 'quick', created_by_coach_id: COACH,
      create_request_id: REQUEST, create_request_hash: `v1:${'a'.repeat(64)}`, library_template_id: null,
    }],
    workout_assignment_exercise_loads: [],
  };
}

function embed(table, select, row) {
  const out = { ...row };
  if (table === 'workouts' && select.includes('client_owner:clients')) {
    const client = tables.clients.find((c) => c.id === row.client_id);
    out.client_owner = client ? { coach_id: client.coach_id } : null;
  }
  if (table === 'workout_assignments' && select.includes('client:clients')) {
    out.client = tables.clients.find((c) => c.id === row.client_id) || null;
  }
  if (table === 'workout_assignments' && select.includes('workout:workouts')) {
    out.workout = tables.workouts.find((w) => w.id === row.workout_id) || null;
  }
  if (table === 'workout_exercises' && select.includes('library_exercise')) out.library_exercise = null;
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
    const filters = []; let select = '*'; let update = null;
    const rows = () => (tables[table] || []).filter((row) => filters.every((f) => f(row))).map((row) => embed(table, select, row));
    const result = (data) => {
      if (readFailures.has(table)) return { data: null, error: { message: `read failed: ${table}` } };
      if (update) {
        for (const row of tables[table].filter((row) => filters.every((f) => f(row)))) Object.assign(row, update);
        if (data) Object.assign(data, update);
      }
      return { data, error: null };
    };
    const chain = {
      select(value = '*') { select = value; return chain; },
      update(value) { update = value; return chain; },
      eq(key, value) { filters.push((row) => row[key] === value); return chain; },
      in(key, values) { filters.push((row) => values.includes(row[key])); return chain; },
      order() { return chain; },
      limit() { return chain; },
      maybeSingle() { return Promise.resolve(result(rows()[0] || null)); },
      single() { return Promise.resolve(result(rows()[0] || null)); },
      then(resolve, reject) { return Promise.resolve(result(rows())).then(resolve, reject); },
    };
    return chain;
  },
} } };
const authPath = require.resolve('../src/middleware/auth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  requireAuth(req, res, next) { if (!actor) return res.status(401).json({ error: 'Unauthorized' }); req.user = actor; next(); },
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

const createBody = (overrides = {}) => ({
  request_id: REQUEST, client_id: CLIENT, assigned_for: '2031-01-01', name: '', notes: '',
  exercises: [{ custom_name: 'Plank', sets: '2', tracking_type: 'duration', duration_value: 45, duration_unit: 's' }],
  ...overrides,
});
const created = (state = 'created') => () => ({ data: { state, assignment_id: ASSIGNMENT, workout_id: WORKOUT }, error: null });
const completion = (completed = false) => (args) => ({ data: args.p_assignment_ids.map((id) => ({ assignment_id: id, completed })), error: null });

test('create requires a coach/admin and validates the whole contract before any RPC', async () => {
  reset(); actor = { role: 'client', client: { id: CLIENT } };
  assert.equal((await call('POST', '/quick-sessions', createBody())).status, 403);
  reset();
  for (const bad of [
    createBody({ created_by_coach_id: OTHER_COACH }), createBody({ create_request_hash: 'v1:x' }), createBody({ request_id: 'nope' }),
    createBody({ exercises: [] }), createBody({ exercises: [{ id: 'we-1', custom_name: 'Plank' }] }), createBody({ is_template: true }),
  ]) {
    const response = await call('POST', '/quick-sessions', bad);
    assert.equal(response.status, 400, JSON.stringify(bad));
  }
  assert.equal(rpcCalls.length, 0);
});

test('A1/A2 create derives the actor from authentication and sends the server fingerprint of the normalized body', async () => {
  reset(); rpcHandlers.create_quick_session = created(); rpcHandlers.get_quick_session_completion = completion(false);
  const response = await call('POST', '/quick-sessions', createBody());
  assert.equal(response.status, 201);
  assert.equal(response.body.state, 'created');
  const [create] = rpcCalls.filter((c) => c.name === 'create_quick_session');
  const expected = normalizeQuickSessionCreate(createBody(), { today: '2031-01-01' });
  assert.deepEqual(create.args, {
    p_actor: COACH, p_client_id: CLIENT, p_request_id: REQUEST, p_hash: quickSessionHash(expected.payload),
    p_assigned_for: '2031-01-01', p_name: 'Quick session · 2031-01-01', p_notes: null, p_exercises: expected.payload.exercises,
  });
  const { assignment } = response.body;
  assert.equal(assignment.id, ASSIGNMENT);
  assert.equal(assignment.kind, 'quick');
  assert.equal(assignment.quick_session_completed, false);
  assert.equal(assignment.library_template_id, null);
  assert.equal(assignment.workout.id, WORKOUT);
  assert.equal(assignment.workout.exercises.length, 1);
  for (const hidden of ['create_request_hash', 'create_request_id', 'client']) assert.ok(!(hidden in assignment), hidden);
  // Admin acts as itself.
  reset(); actor = { role: 'admin', coach: { id: ADMIN } }; rpcHandlers.create_quick_session = created(); rpcHandlers.get_quick_session_completion = completion(false);
  assert.equal((await call('POST', '/quick-sessions', createBody())).status, 201);
  assert.equal(rpcCalls[0].args.p_actor, ADMIN);
});

test('A1 equivalent bodies send equal fingerprints; client or prescription changes do not', async () => {
  reset(); rpcHandlers.create_quick_session = created('replayed'); rpcHandlers.get_quick_session_completion = completion(false);
  await call('POST', '/quick-sessions', createBody());
  await call('POST', '/quick-sessions', createBody({ request_id: REQUEST.toUpperCase(), exercises: [{ name: 'Plank', sets: 2, tracking_type: 'duration', duration_value: '45', duration_unit: 's' }, { custom_name: '' }] }));
  await call('POST', '/quick-sessions', createBody({ client_id: CLIENT_TWO }));
  await call('POST', '/quick-sessions', createBody({ exercises: [{ custom_name: 'Plank', sets: '3', tracking_type: 'duration', duration_value: 45, duration_unit: 's' }] }));
  const hashes = rpcCalls.filter((c) => c.name === 'create_quick_session').map((c) => c.args.p_hash);
  assert.equal(hashes[0], hashes[1]);
  assert.notEqual(hashes[0], hashes[2]);
  assert.notEqual(hashes[0], hashes[3]);
});

test('omitted date defaults to today in Denver and freezes into the title', async () => {
  reset(); rpcHandlers.create_quick_session = created(); rpcHandlers.get_quick_session_completion = completion(false);
  const body = createBody(); delete body.assigned_for;
  const today = todayDateInTz();
  await call('POST', '/quick-sessions', body);
  assert.equal(rpcCalls[0].args.p_assigned_for, today);
  assert.equal(rpcCalls[0].args.p_name, `Quick session · ${today}`);
});

test('R1 envelopes: replay 200, mismatch 409 without details, masked absence 404, errors 500/422', async () => {
  reset(); rpcHandlers.create_quick_session = created('replayed'); rpcHandlers.get_quick_session_completion = completion(true);
  let response = await call('POST', '/quick-sessions', createBody());
  assert.equal(response.status, 200); assert.equal(response.body.state, 'replayed'); assert.equal(response.body.assignment.quick_session_completed, true);
  reset(); rpcHandlers.create_quick_session = () => ({ data: { state: 'request_mismatch' }, error: null });
  response = await call('POST', '/quick-sessions', createBody());
  assert.equal(response.status, 409); assert.deepEqual(response.body, { state: 'request_mismatch' });
  reset(); rpcHandlers.create_quick_session = () => ({ data: { state: 'not_found' }, error: null });
  response = await call('POST', '/quick-sessions', createBody());
  assert.equal(response.status, 404); assert.deepEqual(response.body, { state: 'not_found' });
  reset(); rpcHandlers.create_quick_session = () => ({ data: null, error: { message: 'Hidden exercises cannot be added: Secret Press' } });
  response = await call('POST', '/quick-sessions', createBody());
  assert.equal(response.status, 422); assert.match(response.body.error, /Secret Press/);
  reset(); rpcHandlers.create_quick_session = () => ({ data: null, error: { message: 'connection reset' } });
  response = await call('POST', '/quick-sessions', createBody());
  assert.equal(response.status, 500); assert.ok(!('state' in response.body));
});

test('A2 response hydration rechecks current access; read failures are errors, never absence', async () => {
  reset(); rpcHandlers.create_quick_session = created(); rpcHandlers.get_quick_session_completion = completion(false);
  tables.clients[0].coach_id = OTHER_COACH;   // reassigned after the RPC committed
  let response = await call('POST', '/quick-sessions', createBody());
  assert.equal(response.status, 404); assert.deepEqual(response.body, { state: 'not_found' });
  reset(); rpcHandlers.create_quick_session = created(); readFailures.add('workout_assignments');
  response = await call('POST', '/quick-sessions', createBody());
  assert.equal(response.status, 500); assert.ok(!('state' in response.body));
  reset(); rpcHandlers.create_quick_session = created(); rpcHandlers.get_quick_session_completion = () => ({ data: null, error: { message: 'boom' } });
  response = await call('POST', '/quick-sessions', createBody());
  assert.equal(response.status, 500);
});

test('status lookup: authenticated actor only, committed body, uniform masked absence, errors stay errors', async () => {
  reset(); actor = { role: 'client', client: { id: CLIENT } };
  assert.equal((await call('GET', `/quick-sessions/requests/${REQUEST}`)).status, 403);
  reset();
  assert.equal((await call('GET', '/quick-sessions/requests/not-a-uuid')).status, 400);
  rpcHandlers.get_quick_session_request = () => ({ data: { state: 'committed', assignment_id: ASSIGNMENT, workout_id: WORKOUT }, error: null });
  rpcHandlers.get_quick_session_completion = completion(false);
  let response = await call('GET', `/quick-sessions/requests/${REQUEST.toUpperCase()}`);
  assert.equal(response.status, 200); assert.equal(response.body.state, 'committed'); assert.equal(response.body.assignment.id, ASSIGNMENT);
  assert.deepEqual(rpcCalls[0], { name: 'get_quick_session_request', args: { p_actor: COACH, p_request_id: REQUEST } });
  assert.ok(!rpcCalls.some((c) => c.name === 'create_quick_session'), 'status never creates');
  reset(); rpcHandlers.get_quick_session_request = () => ({ data: { state: 'not_found' }, error: null });
  response = await call('GET', `/quick-sessions/requests/${REQUEST}`);
  assert.equal(response.status, 404); assert.deepEqual(response.body, { state: 'not_found' });
  reset(); rpcHandlers.get_quick_session_request = () => ({ data: { state: 'committed', assignment_id: ASSIGNMENT }, error: null });
  tables.workout_assignments[0].archived = true;
  response = await call('GET', `/quick-sessions/requests/${REQUEST}`);
  assert.equal(response.status, 404); assert.deepEqual(response.body, { state: 'not_found' });
  reset(); rpcHandlers.get_quick_session_request = () => ({ data: null, error: { message: 'timeout' } });
  response = await call('GET', `/quick-sessions/requests/${REQUEST}`);
  assert.equal(response.status, 500); assert.ok(!('state' in response.body));
});

test('A6 library save is independent and idempotent; it never re-sends create', async () => {
  reset(); actor = { role: 'client', client: { id: CLIENT } };
  assert.equal((await call('POST', `/quick-sessions/${ASSIGNMENT}/save-to-library`)).status, 403);
  reset();
  assert.equal((await call('POST', '/quick-sessions/nope/save-to-library')).status, 400);
  rpcHandlers.save_quick_session_to_library = () => ({ data: { state: 'saved', template_id: TEMPLATE }, error: null });
  let response = await call('POST', `/quick-sessions/${ASSIGNMENT}/save-to-library`);
  assert.equal(response.status, 201); assert.deepEqual(response.body, { state: 'saved', template_id: TEMPLATE });
  assert.deepEqual(rpcCalls[0].args, { p_actor: COACH, p_assignment_id: ASSIGNMENT });
  rpcHandlers.save_quick_session_to_library = () => ({ data: { state: 'replayed', template_id: TEMPLATE }, error: null });
  response = await call('POST', `/quick-sessions/${ASSIGNMENT}/save-to-library`);
  assert.equal(response.status, 200); assert.deepEqual(response.body, { state: 'replayed', template_id: TEMPLATE });
  rpcHandlers.save_quick_session_to_library = () => ({ data: { state: 'not_found' }, error: null });
  response = await call('POST', `/quick-sessions/${ASSIGNMENT}/save-to-library`);
  assert.equal(response.status, 404); assert.deepEqual(response.body, { state: 'not_found' });
  rpcHandlers.save_quick_session_to_library = () => ({ data: null, error: { message: 'clone failed' } });
  response = await call('POST', `/quick-sessions/${ASSIGNMENT}/save-to-library`);
  assert.equal(response.status, 500);
  assert.ok(!rpcCalls.some((c) => c.name === 'create_quick_session'));
});

test('A9 begun quick sessions map to 409 quick_session_started on both existing edit routes', async () => {
  reset(); rpcHandlers.save_workout = () => ({ data: null, error: { message: 'quick_session_started' } });
  let response = await call('PUT', `/workouts/${WORKOUT}`, { name: 'Late', exercises: [{ custom_name: 'Plank' }] });
  assert.equal(response.status, 409); assert.equal(response.body.code, 'quick_session_started');
  reset(); rpcHandlers.save_workout_assignment_with_loads = () => ({ data: null, error: { message: 'quick_session_started' } });
  response = await call('PUT', `/workout-assignments/${ASSIGNMENT}/loads`, { notes: 'late', exercise_loads: [] });
  assert.equal(response.status, 409); assert.equal(response.body.code, 'quick_session_started');
  // Lost access stays a masked 404 before any write.
  reset(); tables.clients[0].coach_id = OTHER_COACH;
  response = await call('PUT', `/workout-assignments/${ASSIGNMENT}/loads`, { notes: 'x', exercise_loads: [] });
  assert.equal(response.status, 404); assert.equal(rpcCalls.length, 0);
});

test('A7 coach assignment read annotates quick completion from the authoritative read and fails visibly', async () => {
  reset();
  tables.workout_assignments.push({ id: 'ordinary-1', client_id: CLIENT, workout_id: WORKOUT, assignment_mode: 'active', assigned_for: null, archived: false, kind: 'assigned' });
  rpcHandlers.get_quick_session_completion = completion(true);
  let response = await call('GET', `/workout-assignments/client/${CLIENT}`);
  assert.equal(response.status, 200);
  const quick = response.body.find((row) => row.id === ASSIGNMENT);
  const ordinary = response.body.find((row) => row.id === 'ordinary-1');
  assert.equal(quick.quick_session_completed, true);
  assert.ok(!('quick_session_completed' in ordinary));
  assert.ok(!('create_request_hash' in quick) && !('create_request_id' in quick));
  assert.deepEqual(rpcCalls.find((c) => c.name === 'get_quick_session_completion').args, { p_client_id: CLIENT, p_assignment_ids: [ASSIGNMENT] });
  reset(); rpcHandlers.get_quick_session_completion = () => ({ data: null, error: { message: 'boom' } });
  response = await call('GET', `/workout-assignments/client/${CLIENT}`);
  assert.equal(response.status, 500);
  reset(); rpcHandlers.get_quick_session_completion = () => ({ data: [], error: null });
  response = await call('GET', `/workout-assignments/client/${CLIENT}`);
  assert.equal(response.status, 500, 'a truncated completion read is an error, not "not completed"');
});

test('A7 client assignment allowlist adds only kind and quick_session_completed', async () => {
  reset(); actor = { role: 'client', client: { id: CLIENT } };
  rpcHandlers.get_quick_session_completion = completion(false);
  tables.workout_assignments[0].library_template_id = TEMPLATE;
  tables.program_assignments = [];
  const response = await call('GET', '/client/assigned');
  assert.equal(response.status, 200);
  const [row] = response.body.workouts;
  assert.equal(row.kind, 'quick');
  assert.equal(row.quick_session_completed, false);
  for (const hidden of ['created_by_coach_id', 'create_request_id', 'create_request_hash', 'library_template_id']) assert.ok(!(hidden in row), hidden);
});

// Exercise Media integration: optional external resources keep the existing
// Quick payload/hash contract, while unsafe NEW links never reach its RPC.
test('Quick create rejects unsafe new external video links before its idempotent create RPC', async () => {
  for (const video_url of ['javascript:alert(1)', 'data:text/html,x', 'file:///tmp/source.mp4', 'https://user:pass@example.invalid/video']) {
    reset();
    rpcHandlers.create_quick_session = created();
    rpcHandlers.get_quick_session_completion = completion(false);
    const response = await call('POST', '/quick-sessions', createBody({ exercises: [{ custom_name: 'Synthetic plank', sets: 1, reps: '5', video_url }] }));
    assert.equal(response.status, 400, video_url);
    assert.match(response.body.error, /http\(s\)/);
    assert.equal(rpcCalls.length, 0, 'no receipt or source write for an unsafe link');
  }
});

test('Quick safe optional video links preserve normalized payload and exact server request hash', async () => {
  for (const video_url of [null, '', 'https://youtu.be/synthetic', 'http://example.invalid/owned-resource']) {
    reset();
    rpcHandlers.create_quick_session = created();
    rpcHandlers.get_quick_session_completion = completion(false);
    const body = createBody({ exercises: [{ custom_name: 'Synthetic plank', sets: 1, reps: '5', video_url }] });
    const expected = normalizeQuickSessionCreate(body, { today: todayDateInTz() });
    const response = await call('POST', '/quick-sessions', body);
    assert.equal(response.status, 201);
    const create = rpcCalls.find((entry) => entry.name === 'create_quick_session');
    assert.equal(create.args.p_request_id, expected.request_id);
    assert.equal(create.args.p_hash, quickSessionHash(expected.payload));
    assert.deepEqual(create.args.p_exercises, expected.payload.exercises);
  }
});

for (const role of ['coach', 'admin']) {
  test(`archive sanitizes receipt metadata for authorized ${role} while preserving the coach contract`, async () => {
    reset();
    actor = { role, coach: { id: role === 'admin' ? ADMIN : COACH } };
    tables.workout_assignments[0].library_template_id = TEMPLATE;
    const response = await call('PATCH', `/workout-assignments/${ASSIGNMENT}/archive`);
    assert.equal(response.status, 200);
    assert.equal(response.body.archived, true);
    assert.equal(tables.workout_assignments[0].archived, true);
    assert.equal(response.body.created_by_coach_id, COACH);
    assert.equal(response.body.library_template_id, TEMPLATE);
    for (const hidden of ['create_request_id', 'create_request_hash']) assert.ok(!(hidden in response.body), hidden);
    assert.equal(tables.workout_assignments[0].create_request_id, REQUEST, 'receipt retained on the server');
  });
}

test('archive preserves coach ownership masking, client denial and unauthenticated denial without mutation', async () => {
  for (const [user, expected] of [
    [{ role: 'coach', coach: { id: OTHER_COACH } }, 404],
    [{ role: 'client', client: { id: CLIENT } }, 403],
    [null, 401],
  ]) {
    reset(); actor = user;
    const response = await call('PATCH', `/workout-assignments/${ASSIGNMENT}/archive`);
    assert.equal(response.status, expected);
    assert.equal(tables.workout_assignments[0].archived, false);
    assert.ok(!JSON.stringify(response.body).includes('create_request'));
  }
});

test('committed create and status return retryable errors for workout hydration failure, then recover the same receipt', async () => {
  reset();
  let commits = 0;
  rpcHandlers.create_quick_session = () => ({ data: { state: commits++ === 0 ? 'created' : 'replayed', assignment_id: ASSIGNMENT, workout_id: WORKOUT }, error: null });
  rpcHandlers.get_quick_session_request = () => ({ data: { state: 'committed', assignment_id: ASSIGNMENT }, error: null });
  rpcHandlers.get_quick_session_completion = completion(false);
  readFailures.add('workouts');
  const failures = [];
  for (const [method, path, body] of [
    ['POST', '/quick-sessions', createBody()],
    ['GET', `/quick-sessions/requests/${REQUEST}`, undefined],
  ]) {
    const response = await call(method, path, body);
    failures.push({ status: response.status, hasState: 'state' in response.body });
  }
  assert.deepEqual(failures, [{ status: 500, hasState: false }, { status: 500, hasState: false }], 'create and status failures never claim not_found');
  readFailures.clear();
  for (let i = 0; i < 2; i++) {
    const response = await call('GET', `/quick-sessions/requests/${REQUEST}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.assignment.id, ASSIGNMENT);
  }
  const replay = await call('POST', '/quick-sessions', createBody());
  assert.equal(replay.status, 200);
  assert.equal(replay.body.state, 'replayed');
  assert.equal(replay.body.assignment.id, ASSIGNMENT);
  assert.equal(tables.workout_assignments.length, 1);
  const creates = rpcCalls.filter((entry) => entry.name === 'create_quick_session');
  assert.deepEqual(creates[0].args, creates[1].args, 'retry preserves request UUID and fingerprint');
  tables.workouts = [];
  assert.equal((await call('GET', `/quick-sessions/requests/${REQUEST}`)).status, 404, 'real absence stays masked');
});
