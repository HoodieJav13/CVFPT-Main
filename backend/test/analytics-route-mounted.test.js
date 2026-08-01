// Mounted-route tests for the analytics endpoint.
//
// The Supabase stub below is deliberately NOT a no-op: it honours eq / in /
// gte / lte / lt / order / range and enforces the same 1000-row response cap
// as supabase/config.toml. An earlier no-op harness let five real contract
// bugs pass a green suite — window filters, day boundaries and truncation
// are only testable if the fake actually applies them.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const COACH_ID = 'coach-a';
const OTHER_COACH_ID = 'coach-b';
const MAX_ROWS = 1000; // mirrors supabase/config.toml

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 24 * 3600 * 1000).toISOString();
const day = (daysAgo) => iso(daysAgo).slice(0, 10);

const state = { tables: {}, pageRequests: [] };

function resetTables() {
  state.tables = {
    clients: [{ id: 'c1', name: 'Sarah Martinez', coach_id: COACH_ID, created_at: iso(200), archived: false }],
    sessions: [], workout_assignments: [], workout_logs: [], check_ins: [],
    metrics: [], metric_entries: [], messages: [], booking_requests: [],
  };
  state.pageRequests = [];
}
resetTables();

const supabasePath = require.resolve('../src/supabase');
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: {
    supabaseAdmin: {
      from(table) {
        const filters = [];
        const sorts = [];
        let range = null;
        const chain = {
          select() { return chain; },
          eq(column, value) { filters.push((r) => r[column] === undefined || r[column] === value); return chain; },
          in(column, values) { filters.push((r) => r[column] === undefined || values.includes(r[column])); return chain; },
          gte(column, value) { filters.push((r) => r[column] === undefined || r[column] >= value); return chain; },
          lte(column, value) { filters.push((r) => r[column] === undefined || r[column] <= value); return chain; },
          lt(column, value) { filters.push((r) => r[column] === undefined || r[column] < value); return chain; },
          order(column, opts) { sorts.push({ column, ascending: opts?.ascending !== false }); return chain; },
          limit() { return chain; },
          range(lo, hi) {
            range = [lo, hi];
            state.pageRequests.push({ table, lo, hi, sorts: sorts.map((o) => o.column) });
            return chain;
          },
          then(resolve) {
            let rows = (state.tables[table] || []).filter((row) => filters.every((f) => f(row)));
            if (sorts.length) {
              rows = rows.slice().sort((a, b) => {
                for (const o of sorts) {
                  const av = a[o.column]; const bv = b[o.column];
                  if (av === bv) continue;
                  return (av < bv ? -1 : 1) * (o.ascending ? 1 : -1);
                }
                return 0;
              });
            }
            if (range) rows = rows.slice(range[0], range[1] + 1);
            // PostgREST never returns more than max_rows, whatever was asked.
            resolve({ data: rows.slice(0, MAX_ROWS), error: null });
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
  assert.equal((await get(`?from=${to}&to=${from}`)).status, 400);
  assert.equal((await get(`?from=${iso(400)}&to=${to}`)).status, 400);
  assert.equal((await get(`?from=${from}&to=${to}`)).status, 200);
});

test('clients cannot reach the endpoint at all', async () => {
  const result = await get(`?from=${iso(30)}&to=${iso(0)}`, { role: 'client', client: { id: 'c1' } });
  assert.equal(result.status, 403);
});

test('a coach always gets their own numbers; only an admin may switch', async () => {
  const own = await get(`?from=${iso(30)}&to=${iso(0)}&coach_id=${OTHER_COACH_ID}`);
  assert.equal(own.body.coach_id, COACH_ID);
  const admin = await get(`?from=${iso(30)}&to=${iso(0)}&coach_id=${OTHER_COACH_ID}`, adminUser);
  assert.equal(admin.body.coach_id, OTHER_COACH_ID);
});

test('a coach with no clients returns an empty shape, not an error', async () => {
  resetTables();
  state.tables.clients = [];
  const { status, body } = await get(`?from=${iso(30)}&to=${iso(0)}`);
  assert.equal(status, 200);
  assert.deepEqual(body.attention, []);
  assert.equal(body.personal_records_30d, 0);
  assert.equal(body.previous.sessions.completed, 0);
  // Shape parity: a consumer must not have to special-case the empty response.
  assert.ok(body.previous.range, 'previous.range present even with no clients');
  assert.equal(body.previous.range.to, body.range.from);
  resetTables();
});

test('attention trigger B uses the fixed 30-day window, not the range toggle', async () => {
  resetTables();
  // Four past-due assignments inside the last 30 days, one completed → 25%,
  // which must put the client on the list...
  state.tables.workout_assignments = [
    { id: 'a1', client_id: 'c1', assigned_for: day(25), assignment_mode: 'dated', archived: false },
    { id: 'a2', client_id: 'c1', assigned_for: day(20), assignment_mode: 'dated', archived: false },
    { id: 'a3', client_id: 'c1', assigned_for: day(15), assignment_mode: 'dated', archived: false },
    { id: 'a4', client_id: 'c1', assigned_for: day(3), assignment_mode: 'dated', archived: false },
  ];
  state.tables.workout_logs = [
    { dated_workout_assignment_id: 'a1', status: 'completed', archived: false },
  ];
  state.tables.check_ins = [{ client_id: 'c1', check_in_date: day(1), archived: false }];

  // ...even when the coach is looking at a 7-day range that contains only
  // one of those assignments. The tile follows the range; the trigger does not.
  const { body } = await get(`?from=${iso(7)}&to=${iso(-1)}`);
  assert.equal(body.adherence.assigned, 1, 'tile follows the selected range');
  const row = body.attention.find((r) => r.client_id === 'c1');
  const lowAdherence = row?.reasons.find((r) => r.code === 'low_adherence');
  assert.ok(lowAdherence, 'trigger B still fires from the fixed 30-day window');
  assert.match(lowAdherence.label, /1 of 4 workouts completed/);
  resetTables();
});

test('a long-ignored client still appears — no message cutoff hides them', async () => {
  resetTables();
  state.tables.check_ins = [{ client_id: 'c1', check_in_date: day(1), archived: false }];
  state.tables.sessions = [
    { client_id: 'c1', coach_id: COACH_ID, status: 'completed', scheduled_at: iso(2), archived: false },
  ];
  // Unanswered for 200 days — far outside any windowed read.
  state.tables.messages = [
    { client_id: 'c1', coach_id: COACH_ID, sender_role: 'client', created_at: iso(200), archived: false },
  ];
  const { body } = await get(`?from=${iso(7)}&to=${iso(-1)}`);
  const row = body.attention.find((r) => r.client_id === 'c1');
  const unanswered = row?.reasons.find((r) => r.code === 'unanswered_message');
  assert.ok(unanswered, 'the longest-ignored client must not vanish');
  assert.equal(unanswered.days, 200);
  resetTables();
});

test('reads page past the 1000-row cap instead of silently truncating', async () => {
  resetTables();
  state.tables.check_ins = [{ client_id: 'c1', check_in_date: day(1), archived: false }];
  // 1500 messages: a single capped response would return 1000 and lose the
  // coach reply that clears the thread.
  const messages = [];
  for (let i = 0; i < 1499; i += 1) {
    messages.push({ client_id: 'c1', coach_id: COACH_ID, sender_role: 'client', created_at: iso(300 - i * 0.1), archived: false });
  }
  messages.push({ client_id: 'c1', coach_id: COACH_ID, sender_role: 'coach', created_at: iso(1), archived: false });
  state.tables.messages = messages;

  const { body } = await get(`?from=${iso(7)}&to=${iso(-1)}`);
  const row = body.attention.find((r) => r.client_id === 'c1');
  // The coach reply is row 1500. If paging failed it would be unseen and a
  // stale unanswered-message trigger would fire.
  assert.equal(Boolean(row?.reasons.some((r) => r.code === 'unanswered_message')), false);
  assert.equal(body.coverage.complete, true);
  // Prove more than one page was actually requested for messages.
  const messagePages = state.pageRequests.filter((p) => p.table === 'messages');
  assert.ok(messagePages.length >= 2, `expected paging, saw ${messagePages.length} request(s)`);
  resetTables();
});

test('previous equal window is returned for tile deltas', async () => {
  resetTables();
  state.tables.sessions = [
    { client_id: 'c1', coach_id: COACH_ID, status: 'completed', scheduled_at: iso(3), archived: false },
    { client_id: 'c1', coach_id: COACH_ID, status: 'completed', scheduled_at: iso(5), archived: false },
    // Inside the previous 7-day window (days 8-14 back).
    { client_id: 'c1', coach_id: COACH_ID, status: 'completed', scheduled_at: iso(10), archived: false },
    // Older than both windows — must appear in neither.
    { client_id: 'c1', coach_id: COACH_ID, status: 'completed', scheduled_at: iso(60), archived: false },
  ];
  const { body } = await get(`?from=${iso(7)}&to=${iso(0)}`);
  assert.equal(body.sessions.completed, 2);
  assert.equal(body.previous.sessions.completed, 1);
  assert.ok(body.previous.range.from < body.range.from);
  resetTables();
});

test('day windows follow America/Denver, not UTC', async (t) => {
  resetTables();
  // Pinned: 2026-08-01T04:30:00Z is 2026-07-31 22:30 in Denver, so the two
  // zones disagree on the date. Without pinning, this test would only
  // exercise the boundary when CI happened to run in the right hours.
  const PINNED = new Date('2026-08-01T04:30:00.000Z').getTime();
  t.mock.timers.enable({ apis: ['Date'], now: PINNED });

  const denverToday = '2026-07-31';
  const utcToday = '2026-08-01';
  assert.notEqual(denverToday, utcToday, 'the pinned instant must straddle midnight');

  // A check-in on the Denver date must land inside the fixed window. Under
  // UTC-based bucketing the 30-day floor shifts a day and the freshness
  // arithmetic reads a day early.
  state.tables.check_ins = [{ id: 'k1', client_id: 'c1', check_in_date: denverToday, archived: false }];
  // Assignment dated "today in Denver" is not yet past-due, so it must not
  // count against adherence.
  state.tables.workout_assignments = [
    { id: 'a1', client_id: 'c1', assigned_for: denverToday, assignment_mode: 'dated', archived: false },
  ];

  const from = new Date(PINNED - 7 * 86400000).toISOString();
  const to = new Date(PINNED + 86400000).toISOString();
  const { body } = await get(`?from=${from}&to=${to}`);

  assert.equal(body.check_ins.clients_measured, 1);
  const row = body.attention.find((r) => r.client_id === 'c1');
  assert.equal(Boolean(row?.reasons.some((r) => r.code === 'no_check_in')), false,
    'a check-in dated today in Denver must count as current');
  assert.equal(body.adherence.assigned, 0, "today's assignment is not yet missable");

  t.mock.timers.reset();
  resetTables();
});

test('adherence windows are disjoint — the boundary date counts once', async (t) => {
  resetTables();
  const PINNED = new Date('2026-08-01T18:00:00.000Z').getTime(); // Denver 2026-08-01 12:00
  t.mock.timers.enable({ apis: ['Date'], now: PINNED });

  // A 7-day range whose Denver start date is 2026-07-26.
  const from = new Date('2026-07-26T18:00:00.000Z').toISOString();
  const to = new Date('2026-08-01T18:00:00.000Z').toISOString();

  state.tables.workout_assignments = [
    // Exactly on the boundary between the previous and current windows.
    { id: 'boundary', client_id: 'c1', assigned_for: '2026-07-26', assignment_mode: 'dated', archived: false },
    // Clearly inside the previous window.
    { id: 'prev', client_id: 'c1', assigned_for: '2026-07-22', assignment_mode: 'dated', archived: false },
    // Clearly inside the current window.
    { id: 'curr', client_id: 'c1', assigned_for: '2026-07-30', assignment_mode: 'dated', archived: false },
  ];

  const { body } = await get(`?from=${from}&to=${to}`);
  // Half-open [from, to): boundary belongs to the current window only.
  assert.equal(body.adherence.assigned, 2, 'boundary + curr');
  assert.equal(body.previous.adherence.assigned, 1, 'prev only — boundary must not be double counted');
  // The two windows together must not exceed the number of distinct rows.
  assert.equal(body.adherence.assigned + body.previous.adherence.assigned, 3);

  t.mock.timers.reset();
  resetTables();
});

test('every paged read carries a unique tie-breaker', async () => {
  resetTables();
  state.tables.check_ins = [{ id: 'k1', client_id: 'c1', check_in_date: day(1), archived: false }];
  state.tables.metrics = [{ id: 'm1', client_id: 'c1', improvement_direction: 'higher', archived: false }];
  state.tables.metric_entries = [
    { id: 'e1', metric_id: 'm1', value: 100, recorded_on: day(10), created_at: iso(10), archived: false },
  ];
  await get(`?from=${iso(30)}&to=${iso(0)}`);

  // Paging by a non-unique column alone can skip or duplicate rows across
  // page boundaries — group sessions share scheduled_at, assignments share
  // assigned_for. Every paged query must end on a unique column.
  const offenders = state.pageRequests.filter((p) => !p.sorts.includes('id'));
  assert.deepEqual(offenders.map((p) => p.table), [],
    `these paged reads lack an id tie-breaker: ${offenders.map((p) => p.table).join(', ')}`);

  // Metric entries additionally need created_at, so two entries recorded on
  // the same date have a deterministic chronology for the PR walk.
  const entryPages = state.pageRequests.filter((p) => p.table === 'metric_entries');
  assert.ok(entryPages.length > 0, 'metric_entries was queried');
  for (const page of entryPages) {
    assert.deepEqual(page.sorts, ['recorded_on', 'created_at', 'id']);
  }
  resetTables();
});
