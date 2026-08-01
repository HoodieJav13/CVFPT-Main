// Mounted-route tests for the analytics endpoint: the real router runs on
// a real HTTP server with Supabase and auth stubbed via the per-process
// require cache, so range validation, the admin coach switch, and the
// end-to-end aggregation are exercised rather than pattern-matched.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const COACH_ID = 'coach-a';
const OTHER_COACH_ID = 'coach-b';

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 24 * 3600 * 1000).toISOString();
const day = (daysAgo) => iso(daysAgo).slice(0, 10);

// Per-test knobs. Tables the stub doesn't know about resolve empty.
const state = {
  tables: {},
  lastFilters: [],
};

function resetTables() {
  state.tables = {
    clients: [{ id: 'c1', name: 'Sarah Martinez', created_at: iso(200), archived: false }],
    sessions: [],
    workout_assignments: [],
    workout_logs: [],
    check_ins: [],
    metrics: [],
    metric_entries: [],
    messages: [],
    booking_requests: [],
  };
  state.lastFilters = [];
}
resetTables();

const supabasePath = require.resolve('../src/supabase');
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: {
    supabaseAdmin: {
      from(table) {
        const chain = {
          _table: table,
          _eq: {},
          select() { return chain; },
          eq(column, value) { chain._eq[column] = value; state.lastFilters.push({ table, column, value }); return chain; },
          in() { return chain; },
          gte() { return chain; },
          lte() { return chain; },
          lt() { return chain; },
          order() { return chain; },
          limit() { return chain; },
          then(resolve) {
            let rows = state.tables[table] || [];
            // Honour coach scoping so the admin-switch test is meaningful.
            if (chain._eq.coach_id) rows = rows.filter((r) => r.coach_id === undefined || r.coach_id === chain._eq.coach_id);
            if (chain._eq.status) rows = rows.filter((r) => r.status === undefined || r.status === chain._eq.status);
            resolve({ data: rows, error: null });
          },
        };
        return chain;
      },
    },
  },
};

let currentUser;
const authPath = require.resolve('../src/middleware/auth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    requireAuth: (req, _res, next) => { req.user = currentUser; next(); },
    requireCoach: (req, res, next) => (req.user?.role === 'coach' || req.user?.role === 'admin'
      ? next() : res.status(403).json({ error: 'Coach access required' })),
    requireClient: (_req, res) => res.status(403).json({ error: 'Client access required' }),
    requireAdmin: (_req, _res, next) => next(),
    canAccessClient: () => true,
  },
};

const express = require('express');
const analyticsRouter = require('../src/routes/analytics');

const app = express();
app.use(express.json());
app.use('/api/analytics', analyticsRouter);
const server = http.createServer(app);
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); });

const coachUser = { role: 'coach', coach: { id: COACH_ID } };
const adminUser = { role: 'admin', coach: { id: COACH_ID } };

async function get(query, user = coachUser) {
  currentUser = user;
  const response = await fetch(`${baseUrl}/api/analytics/coach${query}`);
  return { status: response.status, body: await response.json() };
}

test('range is required and sanity-checked', async () => {
  const from = iso(30);
  const to = iso(0);
  assert.equal((await get('')).status, 400);
  assert.equal((await get(`?from=${from}`)).status, 400);
  assert.equal((await get(`?to=${to}`)).status, 400);
  // Inverted range.
  assert.equal((await get(`?from=${to}&to=${from}`)).status, 400);
  // Beyond the 366-day cap.
  assert.equal((await get(`?from=${iso(400)}&to=${to}`)).status, 400);
  assert.equal((await get(`?from=${from}&to=${to}`)).status, 200);
});

test('clients cannot reach the endpoint at all', async () => {
  const result = await get(`?from=${iso(30)}&to=${iso(0)}`, { role: 'client', client: { id: 'c1' } });
  assert.equal(result.status, 403);
});

test('a coach always gets their own numbers, even asking for another coach', async () => {
  const { status, body } = await get(`?from=${iso(30)}&to=${iso(0)}&coach_id=${OTHER_COACH_ID}`);
  assert.equal(status, 200);
  assert.equal(body.coach_id, COACH_ID);
});

test('an admin may switch which coach is being viewed', async () => {
  const { status, body } = await get(`?from=${iso(30)}&to=${iso(0)}&coach_id=${OTHER_COACH_ID}`, adminUser);
  assert.equal(status, 200);
  assert.equal(body.coach_id, OTHER_COACH_ID);
  // The coach filter actually reached the query layer.
  assert.ok(state.lastFilters.some((f) => f.table === 'clients' && f.column === 'coach_id' && f.value === OTHER_COACH_ID));
});

test('a coach with no clients returns an empty shape, not an error', async () => {
  resetTables();
  state.tables.clients = [];
  const { status, body } = await get(`?from=${iso(30)}&to=${iso(0)}`);
  assert.equal(status, 200);
  assert.deepEqual(body.attention, []);
  assert.equal(body.sessions.completed, 0);
  assert.equal(body.personal_records_30d, 0);
  resetTables();
});

test('end to end: tiles aggregate and a real trigger reaches the attention list', async () => {
  resetTables();
  state.tables.sessions = [
    { client_id: 'c1', coach_id: COACH_ID, status: 'completed', scheduled_at: iso(25) },
    { client_id: 'c1', coach_id: COACH_ID, status: 'cancelled', scheduled_at: iso(10) },
    { client_id: 'c1', coach_id: COACH_ID, status: 'scheduled', scheduled_at: iso(5) }, // stale
  ];
  // Two past-due dated assignments, one completed — below 3, so trigger B
  // must NOT fire, but the adherence tile still reports the rate.
  state.tables.workout_assignments = [
    { id: 'a1', client_id: 'c1', assigned_for: day(6) },
    { id: 'a2', client_id: 'c1', assigned_for: day(4) },
  ];
  state.tables.workout_logs = [{ dated_workout_assignment_id: 'a1', status: 'completed' }];
  // Client wrote 5 days ago and was never answered → trigger D.
  state.tables.messages = [
    { client_id: 'c1', coach_id: COACH_ID, sender_role: 'coach', created_at: iso(9) },
    { client_id: 'c1', coach_id: COACH_ID, sender_role: 'client', created_at: iso(5) },
    { client_id: 'c1', coach_id: COACH_ID, sender_role: 'client', created_at: iso(1) },
  ];

  const { status, body } = await get(`?from=${iso(30)}&to=${iso(-1)}`);
  assert.equal(status, 200);
  assert.equal(body.sessions.completed, 1);
  assert.equal(body.sessions.cancelled, 1);
  assert.equal(body.sessions.stale, 1);
  assert.equal(body.sessions.cancellation_rate, 0.5);
  assert.equal(body.adherence.assigned, 2);
  assert.equal(body.adherence.completed, 1);

  const row = body.attention.find((r) => r.client_id === 'c1');
  const codes = row.reasons.map((r) => r.code);
  assert.ok(codes.includes('unanswered_message'), 'unanswered message trigger fires');
  // Measured from the OLDEST unanswered message (5 days), not the newest (1).
  const unanswered = row.reasons.find((r) => r.code === 'unanswered_message');
  assert.equal(unanswered.days, 5);
  // Only 2 eligible assignments — the adherence trigger stays silent.
  assert.equal(codes.includes('low_adherence'), false);
  resetTables();
});

test('response reports the bounded-read ceilings rather than implying full coverage', async () => {
  const { body } = await get(`?from=${iso(30)}&to=${iso(0)}`);
  assert.equal(typeof body.truncated.completed_sessions, 'boolean');
  assert.equal(body.truncated.message_window_days, 90);
});
