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
        let sort = null;
        let range = null;
        const chain = {
          select() { return chain; },
          eq(column, value) { filters.push((r) => r[column] === undefined || r[column] === value); return chain; },
          in(column, values) { filters.push((r) => r[column] === undefined || values.includes(r[column])); return chain; },
          gte(column, value) { filters.push((r) => r[column] === undefined || r[column] >= value); return chain; },
          lte(column, value) { filters.push((r) => r[column] === undefined || r[column] <= value); return chain; },
          lt(column, value) { filters.push((r) => r[column] === undefined || r[column] < value); return chain; },
          order(column, opts) { sort = { column, ascending: opts?.ascending !== false }; return chain; },
          limit() { return chain; },
          range(lo, hi) { range = [lo, hi]; state.pageRequests.push({ table, lo, hi }); return chain; },
          then(resolve) {
            let rows = (state.tables[table] || []).filter((row) => filters.every((f) => f(row)));
            if (sort) {
              rows = rows.slice().sort((a, b) => {
                const av = a[sort.column]; const bv = b[sort.column];
                if (av === bv) return 0;
                return (av < bv ? -1 : 1) * (sort.ascending ? 1 : -1);
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

test('day windows follow America/Denver, not UTC', async () => {
  resetTables();
  // The Denver date is behind UTC in the evening. An assignment dated to
  // "today in Denver" must be inside the fixed 30-day window whichever side
  // of the UTC midnight the server clock sits on.
  const { DEFAULT_TZ } = require('../src/utils/time');
  assert.equal(DEFAULT_TZ, 'America/Denver');
  const denverToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date());
  const utcToday = new Date().toISOString().slice(0, 10);
  state.tables.check_ins = [{ client_id: 'c1', check_in_date: denverToday, archived: false }];
  const { body } = await get(`?from=${iso(7)}&to=${iso(-1)}`);
  // Counted regardless of whether Denver and UTC agree on the date today.
  assert.equal(body.check_ins.clients_measured, 1, `denver=${denverToday} utc=${utcToday}`);
  const row = body.attention.find((r) => r.client_id === 'c1');
  assert.equal(Boolean(row?.reasons.some((r) => r.code === 'no_check_in')), false);
  resetTables();
});
