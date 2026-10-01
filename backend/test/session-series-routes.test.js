// Mounted-route tests for /api/sessions/series. Supabase, auth, email and push are stubbed
// through the per-process require cache; the database functions are stubbed at the rpc() seam.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const COACH_ID = 'aaaaaaaa-0000-0000-0000-00000000000a';
const OTHER_COACH_ID = 'bbbbbbbb-0000-0000-0000-00000000000b';
const CLIENT_ID = 'cccccccc-0000-0000-0000-00000000000c';
const PROGRAM_ID = '77777777-0000-0000-0000-000000000007';
const WORKOUT_ID = '99999999-0000-0000-0000-000000000009';
const SERIES_ID = 'dddddddd-0000-0000-0000-00000000000d';
const REQUEST_ID = 'a0000000-0000-4000-8000-000000000001';

const { shiftDate, todayDateInTz } = require('../src/utils/time');
const { requestHash } = require('../src/lib/sessionSeries/rule');
const TODAY = todayDateInTz();
const day = (offset) => shiftDate(TODAY, offset);

const state = {};
function resetState() {
  Object.assign(state, {
    clientRow: { id: CLIENT_ID, coach_id: COACH_ID, archived: false },
    programRow: { id: PROGRAM_ID, coach_id: COACH_ID, archived: false },
    workouts: [{ id: WORKOUT_ID, coach_id: COACH_ID }],
    existingSeries: null,
    anchorSession: null,
    cancelledRows: [],
    rpcCalls: [],
    rpcImpl: {},
    sessionUpdates: [],
    emails: [],
    cancelEmails: [],
    pushes: 0,
  });
}

function defaultCheck(args) {
  return {
    slots: args.p_slots.map((slot) => ({ key: slot.key, conflict: null })),
    alternatives: (args.p_alternatives || []).map((alt) => ({ key: alt.key, for_key: alt.for_key, free: true })),
  };
}
function defaultCreate(args) {
  const slots = [...args.p_slots].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  return {
    outcome: 'created', replayed: false,
    series: { id: SERIES_ID, coach_id: args.p_coach_id, client_id: args.p_client_id, request_id: args.p_request_id, created_count: slots.length },
    receipt: { slots: slots.map((slot, i) => ({ key: slot.key, session_id: `sess-${i + 1}`, scheduled_at: slot.scheduled_at, workout_id: slot.workout_id ?? null, ordinal: i + 1 })) },
  };
}

const matches = (row, eqs) => Boolean(row) && Object.entries(eqs).every(([key, value]) => !(key in row) || row[key] === value);

const supabasePath = require.resolve('../src/supabase');
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: {
    supabaseAdmin: {
      from(table) {
        const chain = {
          _eqs: {}, _update: null,
          select() { return chain; },
          eq(column, value) { chain._eqs[column] = value; return chain; },
          in() { return chain; },
          gte() { return chain; },
          order() { return chain; },
          update(values) { chain._update = values; state.sessionUpdates.push(values); return chain; },
          maybeSingle() {
            const rows = { clients: state.clientRow, programs: state.programRow, session_series: state.existingSeries, sessions: state.anchorSession };
            const row = rows[table] ?? null;
            return Promise.resolve({ data: matches(row, chain._eqs) ? row : null, error: null });
          },
          then(resolve) {
            if (table === 'workouts') return resolve({ data: state.workouts, error: null });
            if (table === 'sessions' && chain._update) return resolve({ data: state.cancelledRows, error: null });
            return resolve({ data: [], error: null });
          },
        };
        return chain;
      },
      rpc(name, args) {
        state.rpcCalls.push({ name, args });
        const impl = state.rpcImpl[name] || (name === 'check_session_slots' ? defaultCheck : name === 'schedule_session_series' ? defaultCreate : () => null);
        return Promise.resolve({ data: impl(args), error: null });
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
    requireCoach: (req, res, next) => (['coach', 'admin'].includes(req.user?.role) ? next() : res.status(403).json({ error: 'Coach access required' })),
    requireClient: (req, res, next) => (req.user?.role === 'client' ? next() : res.status(403).json({ error: 'Client access required' })),
    canAccessClient: (user, client) => user.role === 'admin' || client.coach_id === user.coach?.id,
  },
};
const emailPath = require.resolve('../src/services/email');
require.cache[emailPath] = {
  id: emailPath, filename: emailPath, loaded: true,
  exports: {
    dispatchEmail: (task) => Promise.resolve().then(task),
    notifySeriesScheduled: (args) => { state.emails.push(args); return Promise.resolve({}); },
    notifySeriesCancelled: (args) => { state.cancelEmails.push(args); return Promise.resolve({}); },
    notifySessionScheduled: () => Promise.resolve({}),
    notifySessionRescheduled: () => Promise.resolve({}),
    notifySessionCancelled: () => Promise.resolve({}),
    notifySessionCancelledByClient: () => Promise.resolve({}),
    notifySessionCancelRequested: () => Promise.resolve({}),
    formatDenver: () => 'formatted',
  },
};
const pushPath = require.resolve('../src/services/push');
require.cache[pushPath] = {
  id: pushPath, filename: pushPath, loaded: true,
  exports: { dispatchPush: () => { state.pushes += 1; return {}; }, sendToClient: () => Promise.resolve({}), sendToCoaches: () => Promise.resolve({}) },
};

const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/sessions', require('../src/routes/sessions'));
const server = http.createServer(app);
let baseUrl;
test.before(async () => { await new Promise((r) => { server.listen(0, '127.0.0.1', r); }); baseUrl = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { server.close(); });

async function call(pathname, { method = 'POST', body } = {}) {
  const response = await fetch(`${baseUrl}/api/sessions/series${pathname}`, {
    method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
const coachUser = { role: 'coach', coach: { id: COACH_ID, name: 'Coach Sam' } };
const checkCalls = () => state.rpcCalls.filter((c) => c.name === 'check_session_slots');
const rows = (count, { time = '17:00', startOffset = 14 } = {}) => Array.from({ length: count }, (_, i) => ({ key: `r${i + 1}`, date: day(startOffset + i), time }));

// ---------- preview ----------
const previewBody = (overrides = {}) => ({
  client_id: CLIENT_ID, start_date: day(14), time: '17:00', duration_minutes: 60,
  weekdays: [0, 1, 2, 3, 4, 5, 6], interval_weeks: 1, end: { count: 4 }, ...overrides,
});

test('preview expands the rule, checks it in one call, and returns display strings', async () => {
  resetState(); currentUser = coachUser;
  const result = await call('/preview', { body: previewBody() });
  assert.equal(result.status, 200);
  assert.equal(result.body.slots.length, 4);
  assert.deepEqual(result.body.slots.map((s) => s.key), ['g1', 'g2', 'g3', 'g4']);
  assert.ok(result.body.slots.every((s) => s.conflict === null && s.suggestions.length === 0 && typeof s.display === 'string'));
  assert.equal(checkCalls().length, 1);
  assert.equal(checkCalls()[0].args.p_alternatives, null);
});

test('preview hides clients the coach cannot access', async () => {
  resetState(); currentUser = coachUser;
  state.clientRow = { id: CLIENT_ID, coach_id: OTHER_COACH_ID, archived: false };
  assert.equal((await call('/preview', { body: previewBody() })).status, 404);
  assert.equal(state.rpcCalls.length, 0);
});

test('preview rejects past starts, too many sessions, and schedules past the horizon without calling the database', async () => {
  resetState(); currentUser = coachUser;
  assert.equal((await call('/preview', { body: previewBody({ start_date: day(-1) }) })).status, 400);
  const tooMany = await call('/preview', { body: previewBody({ end: { until: day(14 + 60) } }) });
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.body.error, /52/);
  const pastHorizon = await call('/preview', { body: previewBody({ weekdays: [(new Date(`${day(14)}T00:00:00Z`)).getUTCDay()], interval_weeks: 2, end: { count: 30 } }) });
  assert.equal(pastHorizon.status, 400);
  assert.match(pastHorizon.body.error, /year/i);
  assert.equal(state.rpcCalls.length, 0);
});

// ---------- check ----------
test('check sends the WHOLE selection to the database and echoes seq', async () => {
  resetState(); currentUser = coachUser;
  const result = await call('/check', { body: { client_id: CLIENT_ID, duration_minutes: 60, start_date: day(14), slots: rows(6), seq: 7 } });
  assert.equal(result.status, 200);
  assert.equal(result.body.seq, 7);
  assert.equal(result.body.slots.length, 6);
  assert.equal(checkCalls()[0].args.p_slots.length, 6);
  assert.ok(checkCalls()[0].args.p_slots.every((s) => /Z$/.test(s.scheduled_at)));
});

test('check enforces the horizon from start_date and rejects bad shapes before any database call', async () => {
  resetState(); currentUser = coachUser;
  const body = (slots, extra = {}) => ({ client_id: CLIENT_ID, duration_minutes: 60, start_date: day(14), slots, ...extra });
  assert.equal((await call('/check', { body: body([{ key: 'a', date: day(14 + 366), time: '17:00' }]) })).status, 400);
  assert.equal((await call('/check', { body: body([{ key: 'a', date: day(14 + 365), time: '17:00' }]) })).status, 200);
  state.rpcCalls.length = 0;
  assert.equal((await call('/check', { body: body([{ key: 'a', date: day(-1), time: '17:00' }]) })).status, 400);
  assert.equal((await call('/check', { body: body([{ key: 'a', date: day(14), time: '17:00' }, { key: 'a', date: day(15), time: '17:00' }]) })).status, 400);
  assert.equal((await call('/check', { body: body([], {}) })).status, 400);
  assert.equal((await call('/check', { body: body(rows(1), { start_date: 'nope' }) })).status, 400);
  assert.equal((await call('/check', { body: body(rows(1), { duration_minutes: 5 }) })).status, 400);
  assert.equal(state.rpcCalls.length, 0);
});

test('check returns nearest-first suggestions (max 3) for a conflicting row, using independent alternatives', async () => {
  resetState(); currentUser = coachUser;
  state.rpcImpl.check_session_slots = (args) => {
    if (!args.p_alternatives) {
      return { slots: args.p_slots.map((s) => ({ key: s.key, conflict: s.key === 'r1' ? { scope: 'coach', session: { id: 'e', scheduled_at: s.scheduled_at } } : null })), alternatives: [] };
    }
    return { slots: [], alternatives: args.p_alternatives.map((alt) => ({ key: alt.key, for_key: alt.for_key, free: true })) };
  };
  const result = await call('/check', { body: { client_id: CLIENT_ID, duration_minutes: 60, start_date: day(14), slots: rows(2, { time: '12:00' }), seq: 1 } });
  const [r1, r2] = result.body.slots;
  assert.equal(r1.conflict.scope, 'coach');
  assert.ok(typeof r1.conflict.display === 'string');
  assert.deepEqual(r1.suggestions.map((s) => s.time), ['12:15', '11:45', '12:30']);
  assert.equal(r2.conflict, null);
  assert.deepEqual(r2.suggestions, []);
  const altCall = checkCalls().find((c) => c.args.p_alternatives);
  assert.ok(altCall.args.p_alternatives.every((alt) => alt.for_key === 'r1'));
  assert.equal(altCall.args.p_slots.length, 2); // every selected row is a blocker
});

test('a maximum-size selection (52 conflicting rows) chunks alternatives into calls of at most 600 with all rows as blockers', async () => {
  resetState(); currentUser = coachUser;
  state.rpcImpl.check_session_slots = (args) => {
    if (!args.p_alternatives) {
      return { slots: args.p_slots.map((s) => ({ key: s.key, conflict: { scope: 'coach', session: { id: 'e', scheduled_at: s.scheduled_at } } })), alternatives: [] };
    }
    return { slots: [], alternatives: args.p_alternatives.map((alt) => ({ key: alt.key, for_key: alt.for_key, free: true })) };
  };
  const result = await call('/check', { body: { client_id: CLIENT_ID, duration_minutes: 60, start_date: day(14), slots: rows(52, { time: '12:00' }) } });
  assert.equal(result.status, 200);
  const altCalls = checkCalls().filter((c) => c.args.p_alternatives);
  assert.deepEqual(altCalls.map((c) => c.args.p_alternatives.length), [600, 600, 48]);
  assert.ok(altCalls.every((c) => c.args.p_slots.length === 52));
  assert.ok(result.body.slots.every((s) => s.suggestions.length === 3));
});

test('suggestions never include times in the past', async () => {
  resetState(); currentUser = coachUser;
  const seen = [];
  state.rpcImpl.check_session_slots = (args) => {
    if (!args.p_alternatives) return { slots: args.p_slots.map((s) => ({ key: s.key, conflict: { scope: 'client', session: { id: 'e', scheduled_at: s.scheduled_at } } })), alternatives: [] };
    seen.push(...args.p_alternatives);
    return { slots: [], alternatives: args.p_alternatives.map((alt) => ({ key: alt.key, for_key: alt.for_key, free: true })) };
  };
  // A slot later today: candidates earlier than "now" must be dropped.
  await call('/check', { body: { client_id: CLIENT_ID, duration_minutes: 60, start_date: TODAY, slots: [{ key: 'today', date: TODAY, time: '20:45' }] } });
  assert.ok(seen.every((alt) => new Date(alt.scheduled_at).getTime() > Date.now()));
});
