// A7/A8 (route/helper halves): authoritative completion flags and safe history provenance.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { canAccessClient } = require('../src/security/access');
const { annotateQuickCompletion, quickCompletionFlags, quickLogKinds } = require('../src/lib/quickSessionReads');

function fakeDb({ rows = {}, rpc = () => ({ data: [], error: null }), fail = new Set() } = {}) {
  const queries = [];
  return {
    queries,
    rpc(name, args) { queries.push({ rpc: name, args }); return Promise.resolve(rpc(name, args)); },
    from(table) {
      const query = { table, select: null, filters: [] }; queries.push(query);
      const chain = {
        select(value) { query.select = value; return chain; },
        eq(key, value) { query.filters.push(['eq', key, value]); return chain; },
        in(key, values) { query.filters.push(['in', key, values]); return chain; },
        then(resolve, reject) {
          if (fail.has(table)) return Promise.resolve({ data: null, error: { message: 'read failed' } }).then(resolve, reject);
          const inFilter = query.filters.find((f) => f[0] === 'in');
          const data = (rows[table] || []).filter((row) => !inFilter || inFilter[2].includes(row[inFilter[1]]));
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
}

test('completion flags come from one authoritative RPC call and every failure is an error', async () => {
  const db = fakeDb({ rpc: (_name, args) => ({ data: args.p_assignment_ids.map((id, i) => ({ assignment_id: id, completed: i === 0 })), error: null }) });
  const flags = await quickCompletionFlags('client-a', ['q1', 'q2', 'q1'], { db });
  assert.deepEqual([...flags], [['q1', true], ['q2', false]]);
  assert.deepEqual(db.queries, [{ rpc: 'get_quick_session_completion', args: { p_client_id: 'client-a', p_assignment_ids: ['q1', 'q2'] } }]);
  assert.deepEqual([...(await quickCompletionFlags('client-a', [], { db: fakeDb() }))], []);
  await assert.rejects(quickCompletionFlags('client-a', ['q1'], { db: fakeDb({ rpc: () => ({ data: null, error: new Error('boom') }) }) }), /boom/);
  await assert.rejects(quickCompletionFlags('client-a', ['q1', 'q2'], { db: fakeDb({ rpc: () => ({ data: [{ assignment_id: 'q1', completed: true }], error: null }) }) }), /incomplete/);
});

test('A7 annotation marks quick rows only, keeps every underlying row, and never filters', async () => {
  const db = fakeDb({ rpc: () => ({ data: [{ assignment_id: 'q1', completed: true }], error: null }) });
  const rows = [{ id: 'q1', kind: 'quick' }, { id: 'o1', kind: 'assigned' }, { id: 'legacy' }];
  const annotated = await annotateQuickCompletion('client-a', rows, { db });
  assert.equal(annotated.length, 3);
  assert.equal(annotated[0].quick_session_completed, true);
  assert.ok(!('quick_session_completed' in annotated[1]) && !('quick_session_completed' in annotated[2]));
  assert.equal(db.queries.length, 1, 'one completion read, no history pagination');
});

test('A8 log kinds use each log\'s own assignment, include archived sources, and expose only the enum', async () => {
  const db = fakeDb({ rows: { workout_assignments: [
    { id: 'qa', kind: 'quick', archived: true, create_request_hash: 'secret' },
    { id: 'oa', kind: 'assigned', archived: false },
  ] } });
  const kinds = await quickLogKinds([
    { id: 'l1', workout_assignment_id: 'qa' }, { id: 'l2', workout_assignment_id: 'oa' },
    { id: 'l3', workout_assignment_id: null, program_assignment_id: 'pa' }, { id: 'l4', workout_assignment_id: 'gone' },
  ], { db });
  assert.deepEqual([...kinds], [['l1', 'quick'], ['l2', 'assigned'], ['l3', null], ['l4', null]]);
  const [query] = db.queries;
  assert.equal(query.select, 'id, kind');
  assert.ok(!query.filters.some((f) => f[1] === 'archived'), 'archived sources stay labeled');
  assert.equal(db.queries.length, 1, 'one query for any number of logs');
  await assert.rejects(quickLogKinds([{ id: 'l1', workout_assignment_id: 'qa' }], { db: fakeDb({ fail: new Set(['workout_assignments']) }) }), (error) => error.message === 'read failed');
  assert.equal((await quickLogKinds([{ id: 'l3', workout_assignment_id: null }], { db: fakeDb() })).get('l3'), null);
});

// Mounted: single detail and paged bulk history agree on the label.
let actor; let tables;
function resetTables() {
  actor = { role: 'coach', coach: { id: 'coach-a' } };
  const client = { id: 'client-a', name: 'Sarah Fixture', coach_id: 'coach-a', archived: false };
  tables = {
    workout_logs: [
      { id: 'log-quick', client_id: 'client-a', status: 'completed', archived: false, completed_at: '2031-01-03T00:00:00Z', workout_assignment_id: 'qa', quick_completed: false, client },
      { id: 'log-ordinary', client_id: 'client-a', status: 'completed', archived: false, completed_at: '2031-01-02T00:00:00Z', workout_assignment_id: 'oa', quick_completed: true, client },
      { id: 'log-program', client_id: 'client-a', status: 'completed', archived: false, completed_at: '2031-01-01T00:00:00Z', workout_assignment_id: null, program_assignment_id: 'pa', quick_completed: false, client },
    ],
    workout_assignments: [
      { id: 'qa', kind: 'quick', archived: true, client_id: 'client-b-private', create_request_hash: 'v1:secret', created_by_coach_id: 'coach-a', library_template_id: 'tmpl', notes: 'private' },
      { id: 'oa', kind: 'assigned', archived: false },
    ],
    clients: [client],
  };
}
resetTables();
const dbPath = require.resolve('../src/supabase');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { supabaseAdmin: {
  rpc() { return Promise.resolve({ data: null, error: { message: 'unexpected rpc' } }); },
  from(table) {
    const filters = []; let limit = Infinity;
    const rows = () => (tables[table] || []).filter((row) => filters.every((f) => f(row))).slice(0, limit);
    const chain = {
      select() { return chain; }, order() { return chain; }, or() { return chain; }, not() { return chain; },
      limit(n) { limit = n; return chain; },
      eq(key, value) { filters.push((row) => row[key] === value); return chain; },
      in(key, values) { filters.push((row) => values.includes(row[key])); return chain; },
      is(key, value) { filters.push((row) => (row[key] ?? null) === value); return chain; },
      maybeSingle() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
      then(resolve, reject) { return Promise.resolve({ data: rows(), error: null }).then(resolve, reject); },
    };
    return chain;
  },
} } };
const authPath = require.resolve('../src/middleware/auth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  requireAuth(req, _res, next) { req.user = actor; next(); },
  requireCoach(req, res, next) { if (['coach', 'admin'].includes(req.user.role)) next(); else res.status(403).json({}); },
  requireClient(req, res, next) { if (req.user.role === 'client') next(); else res.status(403).json({}); },
  canAccessClient,
} };
const app = express(); app.use(express.json());
app.use('/api/workout-logs', require('../src/routes/workoutLogs'));
let server; let base;
test.before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => new Promise((resolve) => server.close(resolve)));
const get = async (path) => { const res = await fetch(`${base}/api/workout-logs${path}`); return { status: res.status, body: await res.json() }; };

test('A8 coach/client detail and paged/unpaged history agree; provenance leaks nothing else', async () => {
  resetTables();
  const expected = { 'log-quick': 'quick', 'log-ordinary': 'assigned', 'log-program': null };
  for (const [path, who] of [['/client/client-a?paged=1', 'coach'], ['/client/client-a', 'coach'], ['/mine?paged=1', 'client'], ['/mine', 'client']]) {
    actor = who === 'coach' ? { role: 'coach', coach: { id: 'coach-a' } } : { role: 'client', client: { id: 'client-a' } };
    const response = await get(path);
    assert.equal(response.status, 200, path);
    const logs = Array.isArray(response.body) ? response.body : response.body.logs;
    assert.deepEqual(Object.fromEntries(logs.map((log) => [log.id, log.workout_assignment_kind])), expected, path);
    for (const log of logs) {
      for (const leak of ['create_request_hash', 'create_request_id', 'created_by_coach_id', 'library_template_id', 'kind']) assert.ok(!(leak in log), `${path} ${leak}`);
      assert.ok(!JSON.stringify(log).includes('secret') && !JSON.stringify(log).includes('client-b-private'), path);
    }
    // Untracked completion stays independent of provenance.
    assert.equal(logs.find((log) => log.id === 'log-ordinary').quick_completed, true);
    assert.equal(logs.find((log) => log.id === 'log-quick').quick_completed, false);
  }
  for (const [id, kind] of Object.entries(expected)) {
    actor = { role: 'coach', coach: { id: 'coach-a' } };
    const detail = await get(`/${id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.workout_assignment_kind, kind, id);
    actor = { role: 'client', client: { id: 'client-a' } };
    assert.equal((await get(`/${id}`)).body.workout_assignment_kind, kind);
  }
  actor = { role: 'coach', coach: { id: 'coach-b' } };
  assert.equal((await get('/log-quick')).status, 404, 'existing log authorization still masks other coaches');
});
