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
    sessionSelects: [],
    queryErrors: {},   // table -> true: that table's single-row lookups return a database error
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
          select(columns) { if (table === 'sessions' && typeof columns === 'string') state.sessionSelects.push(columns); return chain; },
          eq(column, value) { chain._eqs[column] = value; return chain; },
          in() { return chain; },
          gte() { return chain; },
          order() { return chain; },
          update(values) { chain._update = values; state.sessionUpdates.push(values); return chain; },
          maybeSingle() {
            if (state.queryErrors[table]) return Promise.resolve({ data: null, error: { message: 'connection reset by peer' } });
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


// ---------- create ----------
const { parseCreateRequest } = require('../src/lib/sessionSeries/createRequest');
const createBody = (overrides = {}) => ({
  request_id: REQUEST_ID, client_id: CLIENT_ID, duration_minutes: 60, location: 'CVF Studio',
  rule: { start_date: day(14), time: '17:00', weekdays: [2, 4], interval_weeks: 1, end: { count: 3 } },
  slots: [
    { key: 'g1', date: day(14), time: '17:00', workout_id: WORKOUT_ID },
    { key: 'g2', date: day(16), time: '17:00', workout_id: null },
    { key: 'g3', date: day(21), time: '17:00' },
  ],
  program_id: null, assign_program: false, notify: true, ...overrides,
});
const createCalls = () => state.rpcCalls.filter((c) => c.name === 'schedule_session_series');
const hashOf = (body) => requestHash(parseCreateRequest(body).normalized);

test('create saves the batch, passes UTC slots in, and sends exactly one email and one push', async () => {
  resetState(); currentUser = coachUser;
  const result = await call('', { body: createBody() });
  assert.equal(result.status, 201);
  assert.equal(result.body.replayed, false);
  assert.equal(result.body.series.id, SERIES_ID);
  assert.equal(result.body.receipt.slots.length, 3);
  const args = createCalls()[0].args;
  assert.equal(args.p_coach_id, COACH_ID);
  assert.equal(args.p_request_id, REQUEST_ID);
  assert.equal(args.p_request_hash, hashOf(createBody()));
  assert.equal(args.p_slots.length, 3);
  assert.ok(args.p_slots.every((s) => /Z$/.test(s.scheduled_at)));
  assert.equal(args.p_slots.find((s) => s.key === 'g1').workout_id, WORKOUT_ID);
  assert.equal(args.p_location, 'CVF Studio');
  assert.equal(state.emails.length, 1);
  assert.equal(state.emails[0].dates.length, 3);
  assert.equal(state.pushes, 1);
});

test('create with notify false is silent', async () => {
  resetState(); currentUser = coachUser;
  const result = await call('', { body: createBody({ notify: false }) });
  assert.equal(result.status, 201);
  assert.equal(state.emails.length, 0);
  assert.equal(state.pushes, 0);
});

test('create validates shape, then eligibility, before any database write', async () => {
  resetState(); currentUser = coachUser;
  const bad = [
    createBody({ request_id: 'nope' }),
    createBody({ slots: [] }),
    createBody({ duration_minutes: 5 }),
    createBody({ notify: 'yes' }),
    createBody({ assign_program: 'yes' }),
    createBody({ slots: [{ key: 'a', date: day(14), time: '17:00', workout_id: 'bad' }] }),
  ];
  for (const body of bad) assert.equal((await call('', { body })).status, 400, JSON.stringify(body).slice(0, 80));
  // eligibility for NEW operations:
  assert.equal((await call('', { body: createBody({ slots: [{ key: 'a', date: day(-2), time: '17:00' }] }) })).status, 400);
  assert.equal((await call('', { body: createBody({ rule: { ...createBody().rule, start_date: day(-2) } }) })).status, 400);
  assert.equal((await call('', { body: createBody({ slots: [{ key: 'a', date: day(14 + 366), time: '17:00' }] }) })).status, 400);
  state.workouts = [{ id: WORKOUT_ID, coach_id: OTHER_COACH_ID }];
  assert.equal((await call('', { body: createBody() })).status, 400); // foreign workout
  state.workouts = [{ id: WORKOUT_ID, coach_id: null }];            // shared workout is fine
  assert.equal((await call('', { body: createBody({ program_id: PROGRAM_ID }) })).status, 201);
  assert.equal(createCalls().length, 1); // only the final, valid request reached the database
});

test('create refuses clients and programs the caller cannot use', async () => {
  resetState(); currentUser = coachUser;
  state.clientRow = { id: CLIENT_ID, coach_id: OTHER_COACH_ID, archived: false };
  assert.equal((await call('', { body: createBody() })).status, 404);
  resetState(); currentUser = coachUser;
  state.programRow = { id: PROGRAM_ID, coach_id: OTHER_COACH_ID, archived: false };
  assert.equal((await call('', { body: createBody({ program_id: PROGRAM_ID }) })).status, 404);
  resetState(); currentUser = coachUser;
  state.programRow = null; // archived or missing
  assert.equal((await call('', { body: createBody({ program_id: PROGRAM_ID, assign_program: false }) })).status, 404);
  assert.equal(createCalls().length, 0);
});

test('an admin saves for the client\'s coach', async () => {
  resetState(); currentUser = { role: 'admin', coach: { id: 'admin-coach' } };
  state.clientRow = { id: CLIENT_ID, coach_id: OTHER_COACH_ID, archived: false };
  state.workouts = [{ id: WORKOUT_ID, coach_id: OTHER_COACH_ID }];
  const result = await call('', { body: createBody() });
  assert.equal(result.status, 201);
  assert.equal(createCalls()[0].args.p_coach_id, OTHER_COACH_ID);
});

test('assign_program and program_id reach the database function', async () => {
  resetState(); currentUser = coachUser;
  await call('', { body: createBody({ program_id: PROGRAM_ID, assign_program: true }) });
  const args = createCalls()[0].args;
  assert.equal(args.p_program_id, PROGRAM_ID);
  assert.equal(args.p_assign_program, true);
});

test('save-time conflicts return 409 with every conflict by key and notify nobody', async () => {
  resetState(); currentUser = coachUser;
  state.rpcImpl.schedule_session_series = () => ({
    outcome: 'conflicts',
    conflicts: [
      { key: 'g1', scope: 'coach', session: { id: 'x', scheduled_at: new Date(Date.now() + 14 * 86400000).toISOString() } },
      { key: 'g2', scope: 'batch', with_key: 'g3' },
    ],
  });
  const result = await call('', { body: createBody() });
  assert.equal(result.status, 409);
  assert.equal(result.body.conflicts.length, 2);
  assert.equal(result.body.conflicts[0].key, 'g1');
  assert.ok(typeof result.body.conflicts[0].display === 'string');
  assert.equal(result.body.conflicts[1].with_key, 'g3');
  assert.equal(state.emails.length, 0);
  assert.equal(state.pushes, 0);
});

test('EARLY replay: a saved request is recovered even when its dates are now in the past, with no database call and no notification', async () => {
  resetState(); currentUser = coachUser;
  const body = createBody({
    rule: { start_date: '2020-01-07', time: '17:00', weekdays: [2], interval_weeks: 1, end: { count: 1 } },
    slots: [{ key: 'g1', date: '2020-01-07', time: '17:00', workout_id: null }],
  });
  state.existingSeries = { id: SERIES_ID, coach_id: COACH_ID, client_id: CLIENT_ID, request_id: REQUEST_ID, request_hash: hashOf(body), receipt: { slots: [{ key: 'g1', session_id: 's1' }] } };
  const result = await call('', { body });
  assert.equal(result.status, 200);
  assert.equal(result.body.replayed, true);
  assert.equal(result.body.receipt.slots[0].key, 'g1');
  assert.equal(state.rpcCalls.length, 0);
  assert.equal(state.emails.length, 0);
  assert.equal(state.pushes, 0);
});

test('replay with a different body is a request_mismatch 409; another coach\'s request id is a 404', async () => {
  resetState(); currentUser = coachUser;
  state.existingSeries = { id: SERIES_ID, coach_id: COACH_ID, client_id: CLIENT_ID, request_id: REQUEST_ID, request_hash: 'something-else', receipt: { slots: [] } };
  const mismatch = await call('', { body: createBody() });
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.body.code, 'request_mismatch');
  state.existingSeries = { ...state.existingSeries, coach_id: OTHER_COACH_ID, request_hash: hashOf(createBody()) };
  assert.equal((await call('', { body: createBody() })).status, 404);
  assert.equal(createCalls().length, 0);
});

test('DATABASE-LEVEL replay (both requests passed the early lookup) is a 200 and sends NO notification', async () => {
  resetState(); currentUser = coachUser;
  state.rpcImpl.schedule_session_series = (args) => ({ ...defaultCreate(args), replayed: true });
  const result = await call('', { body: createBody() });
  assert.equal(result.status, 200);
  assert.equal(result.body.replayed, true);
  assert.equal(state.emails.length, 0);
  assert.equal(state.pushes, 0);
});

test('a request_mismatch reported by the database function is also a 409 code request_mismatch', async () => {
  resetState(); currentUser = coachUser;
  state.rpcImpl.schedule_session_series = () => ({ outcome: 'request_mismatch' });
  const result = await call('', { body: createBody() });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'request_mismatch');
});

test('series routes require a coach', async () => {
  resetState(); currentUser = { role: 'client', client: { id: CLIENT_ID } };
  assert.equal((await call('', { body: createBody() })).status, 403);
  assert.equal((await call('/preview', { body: previewBody() })).status, 403);
  assert.equal((await call('/check', { body: {} })).status, 403);
});


// ---------- cancel this-and-future ----------
const ANCHOR_ID = 'eeeeeeee-0000-0000-0000-00000000000e';
const cancelBody = (overrides = {}) => ({ from_session_id: ANCHOR_ID, notify: true, ...overrides });
function seedSeriesForCancel() {
  state.existingSeries = { id: SERIES_ID, coach_id: COACH_ID, client_id: CLIENT_ID, archived: false };
  state.anchorSession = { id: ANCHOR_ID, series_id: SERIES_ID, client_id: CLIENT_ID, scheduled_at: new Date(Date.now() + 7 * 86400000).toISOString(), archived: false };
  state.cancelledRows = [
    { id: ANCHOR_ID, scheduled_at: state.anchorSession.scheduled_at },
    { id: 'later-1', scheduled_at: new Date(Date.now() + 14 * 86400000).toISOString() },
  ];
}

test('cancel this-and-future changes only the returned scheduled rows and sends one summary', async () => {
  resetState(); currentUser = coachUser; seedSeriesForCancel();
  const result = await call(`/${SERIES_ID}/cancel`, { method: 'PATCH', body: cancelBody() });
  assert.equal(result.status, 200);
  assert.equal(result.body.cancelled.length, 2);
  assert.deepEqual(state.sessionUpdates.map((u) => u.status), ['cancelled']);
  assert.equal(state.cancelEmails.length, 1);
  assert.equal(state.cancelEmails[0].cancelled.length, 2);
  assert.equal(state.cancelEmails[0].seriesId, SERIES_ID);
  assert.equal(state.pushes, 1);
});

test('cancel with notify false is silent; a retry that changes zero rows sends nothing', async () => {
  resetState(); currentUser = coachUser; seedSeriesForCancel();
  assert.equal((await call(`/${SERIES_ID}/cancel`, { method: 'PATCH', body: cancelBody({ notify: false }) })).status, 200);
  assert.equal(state.cancelEmails.length, 0);
  resetState(); currentUser = coachUser; seedSeriesForCancel();
  state.cancelledRows = []; // nothing left to cancel
  const retry = await call(`/${SERIES_ID}/cancel`, { method: 'PATCH', body: cancelBody() });
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.body.cancelled, []);
  assert.equal(state.cancelEmails.length, 0);
  assert.equal(state.pushes, 0);
});

test('cancel validates ids and the notify flag, and masks other coaches\' series and foreign anchors', async () => {
  resetState(); currentUser = coachUser; seedSeriesForCancel();
  assert.equal((await call('/not-a-uuid/cancel', { method: 'PATCH', body: cancelBody() })).status, 400);
  assert.equal((await call(`/${SERIES_ID}/cancel`, { method: 'PATCH', body: cancelBody({ from_session_id: 'nope' }) })).status, 400);
  assert.equal((await call(`/${SERIES_ID}/cancel`, { method: 'PATCH', body: cancelBody({ notify: 'x' }) })).status, 400);
  state.existingSeries = { ...state.existingSeries, coach_id: OTHER_COACH_ID };
  assert.equal((await call(`/${SERIES_ID}/cancel`, { method: 'PATCH', body: cancelBody() })).status, 404);
  seedSeriesForCancel();
  state.anchorSession = { ...state.anchorSession, series_id: 'some-other-series' };
  assert.equal((await call(`/${SERIES_ID}/cancel`, { method: 'PATCH', body: cancelBody() })).status, 404);
  seedSeriesForCancel();
  state.anchorSession = { ...state.anchorSession, client_id: 'someone-else' };
  assert.equal((await call(`/${SERIES_ID}/cancel`, { method: 'PATCH', body: cancelBody() })).status, 404);
  assert.equal(state.sessionUpdates.length, 0);
});

test('coach list and coach detail embed the series for session rows', async () => {
  resetState(); currentUser = coachUser;
  state.anchorSession = { id: ANCHOR_ID, coach_id: COACH_ID, client_id: CLIENT_ID, scheduled_at: new Date().toISOString(), archived: false };
  await fetch(`${baseUrl}/api/sessions`).then((r) => r.json());
  await fetch(`${baseUrl}/api/sessions/${ANCHOR_ID}/coach-detail`).then((r) => r.json());
  const embeds = state.sessionSelects.filter((columns) => columns.includes('series:session_series(id, rule, created_count)'));
  assert.equal(embeds.length, 2, `selects seen: ${state.sessionSelects.join(' | ')}`);
});

// ---------- database failures are retryable server errors, never "not found" ----------
test('a FAILED replay lookup is a retryable 500 (never a definitive 400/404), and a later successful lookup recovers the receipt', async () => {
  resetState(); currentUser = coachUser;
  const body = createBody({
    rule: { start_date: '2020-01-07', time: '17:00', weekdays: [2], interval_weeks: 1, end: { count: 1 } },
    slots: [{ key: 'g1', date: '2020-01-07', time: '17:00', workout_id: null }],   // long past
  });
  state.existingSeries = { id: SERIES_ID, coach_id: COACH_ID, client_id: CLIENT_ID, request_id: REQUEST_ID, request_hash: hashOf(body), receipt: { slots: [{ key: 'g1', session_id: 's1' }] } };
  state.queryErrors.session_series = true;
  state.queryErrors.clients = true;                       // the follow-on lookups would also fail: still not a 404
  const failed = await call('', { body });
  assert.equal(failed.status, 500, 'the outcome of the original save is unknown, so this must be retryable');
  assert.equal(state.rpcCalls.length, 0, 'no eligibility checks, no writes');
  assert.equal(state.emails.length, 0);
  assert.equal(state.pushes, 0);

  state.queryErrors = {};                                 // the database comes back
  const recovered = await call('', { body });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.replayed, true);
  assert.equal(recovered.body.receipt.slots[0].key, 'g1');
  assert.equal(state.rpcCalls.length, 0);
});

test('a failed CLIENT lookup is a 500 on preview, check and create; a genuinely missing client is still a 404', async () => {
  resetState(); currentUser = coachUser;
  state.queryErrors.clients = true;
  assert.equal((await call('/preview', { body: previewBody() })).status, 500);
  assert.equal((await call('/check', { body: { client_id: CLIENT_ID, duration_minutes: 60, start_date: day(14), slots: rows(1) } })).status, 500);
  assert.equal((await call('', { body: createBody() })).status, 500);
  assert.equal(state.rpcCalls.length, 0);
  state.queryErrors = {};
  state.clientRow = null;                                 // genuinely missing / archived
  assert.equal((await call('/preview', { body: previewBody() })).status, 404);
  assert.equal((await call('', { body: createBody() })).status, 404);
});

test('a failed PROGRAM lookup is a 500 and writes nothing; a genuinely missing program is still a 404', async () => {
  resetState(); currentUser = coachUser;
  state.queryErrors.programs = true;
  assert.equal((await call('', { body: createBody({ program_id: PROGRAM_ID }) })).status, 500);
  assert.equal(createCalls().length, 0);
  state.queryErrors = {};
  state.programRow = null;
  assert.equal((await call('', { body: createBody({ program_id: PROGRAM_ID }) })).status, 404);
  assert.equal(createCalls().length, 0);
});

test('failed series/anchor lookups on cancel are 500s that change nothing; missing ones are still 404', async () => {
  resetState(); currentUser = coachUser; seedSeriesForCancel();
  state.queryErrors.session_series = true;
  assert.equal((await call(`/${SERIES_ID}/cancel`, { method: 'PATCH', body: cancelBody() })).status, 500);
  state.queryErrors = { sessions: true };
  assert.equal((await call(`/${SERIES_ID}/cancel`, { method: 'PATCH', body: cancelBody() })).status, 500);
  assert.equal(state.sessionUpdates.length, 0);
  assert.equal(state.cancelEmails.length, 0);
  state.queryErrors = {};
  state.existingSeries = null;
  assert.equal((await call(`/${SERIES_ID}/cancel`, { method: 'PATCH', body: cancelBody() })).status, 404);
});
