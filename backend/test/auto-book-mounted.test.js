// Mounted-route tests for auto-book: the real bookings and availability
// routers run on a real HTTP server with the Supabase client and auth
// stubbed via the per-process require cache. These execute the routes —
// opt-in success, conflict fallback, no-hours fallback, RPC null and
// unexpected outcomes, and own-coach-only toggling — rather than
// pattern-matching source text.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const COACH_ID = 'aaaaaaaa-0000-0000-0000-00000000000a';
const CLIENT_ID = 'cccccccc-0000-0000-0000-00000000000c';
const SLOT_ISO = '2026-08-05T15:00:00.000Z'; // must stay in the future

// Per-test knobs the stub reads.
const state = {
  hoursCount: 1,
  coachAutoBook: true,
  openSlots: [{ starts_at: SLOT_ISO, ends_at: '2026-08-05T16:00:00.000Z' }],
  requestBookingResult: null, // set per test
  lastRequestBookingArgs: null,
  lastCoachUpdate: null,
};

const requestRow = {
  id: 'req-1', client_id: CLIENT_ID, coach_id: COACH_ID, requested_time: SLOT_ISO,
  duration_minutes: 60, location: null, note: null, status: 'pending', archived: false,
};

const supabasePath = require.resolve('../src/supabase');
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: {
    supabaseAdmin: {
      from(table) {
        const chain = {
          select(_cols, opts) { chain._head = Boolean(opts?.head); return chain; },
          eq(col, value) { if (table === 'coaches' && col === 'id') chain._coachId = value; return chain; },
          neq() { return chain; },
          gte() { return chain; },
          lt() { return chain; },
          order() { return chain; },
          update(values) { chain._update = values; return chain; },
          maybeSingle() {
            return Promise.resolve({ data: table === 'coaches' ? { auto_book: state.coachAutoBook } : null, error: null });
          },
          single() {
            if (table === 'coaches' && chain._update) {
              state.lastCoachUpdate = { id: chain._coachId, values: chain._update };
              return Promise.resolve({ data: { auto_book: chain._update.auto_book }, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
          then(resolve) {
            if (table === 'session_types') {
              resolve({ data: [{ duration_minutes: 30 }, { duration_minutes: 45 }, { duration_minutes: 60 }], error: null });
            } else if (chain._head) {
              resolve({ count: state.hoursCount, error: null });
            } else {
              resolve({ data: [], error: null });
            }
          },
        };
        return chain;
      },
      rpc(name, args) {
        if (name === 'get_open_slots') return Promise.resolve({ data: state.openSlots, error: null });
        if (name === 'request_booking') {
          state.lastRequestBookingArgs = args;
          return Promise.resolve({ data: state.requestBookingResult, error: null });
        }
        return Promise.resolve({ data: null, error: null });
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
    requireCoach: (req, res, next) => (req.user?.role === 'coach' || req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Coach access required' })),
    requireClient: (req, res, next) => (req.user?.role === 'client' ? next() : res.status(403).json({ error: 'Client access required' })),
    requireAdmin: (_req, _res, next) => next(),
    canAccessClient: () => true,
  },
};

const express = require('express');
const bookingsRouter = require('../src/routes/bookings');
const availabilityRouter = require('../src/routes/availability');

const app = express();
app.use(express.json());
app.use('/api/bookings', bookingsRouter);
app.use('/api/availability', availabilityRouter);
const server = http.createServer(app);
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); });

const clientUser = { role: 'client', client: { id: CLIENT_ID, coach_id: COACH_ID } };

async function postBooking() {
  currentUser = clientUser;
  const response = await fetch(`${baseUrl}/api/bookings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requested_time: SLOT_ISO, duration_minutes: 60 }),
  });
  return { status: response.status, body: await response.json() };
}

test('opt-in success: offered slot + auto_book coach books instantly', async () => {
  state.hoursCount = 1;
  state.coachAutoBook = true;
  state.requestBookingResult = {
    outcome: 'auto_booked',
    request: { ...requestRow, status: 'approved' },
    session: { id: 'sess-1', scheduled_at: SLOT_ISO },
  };
  const { status, body } = await postBooking();
  assert.equal(status, 201);
  assert.equal(body.auto_booked, true);
  assert.equal(body.status, 'approved');
  assert.equal(body.session.id, 'sess-1');
  assert.equal(state.lastRequestBookingArgs.p_auto_book, true);
});

test('conflict fallback: lost race stays pending, still a 201', async () => {
  state.requestBookingResult = { outcome: 'pending', request: requestRow };
  const { status, body } = await postBooking();
  assert.equal(status, 201);
  assert.equal(body.auto_booked, false);
  assert.equal(body.status, 'pending');
});

test('no published hours: never auto-books even with the flag on', async () => {
  state.hoursCount = 0;
  state.coachAutoBook = true;
  state.requestBookingResult = { outcome: 'pending', request: requestRow };
  const { status, body } = await postBooking();
  assert.equal(status, 201);
  assert.equal(body.auto_booked, false);
  assert.equal(state.lastRequestBookingArgs.p_auto_book, false);
  state.hoursCount = 1;
});

test('null and unexpected RPC outcomes fail safely — never a booked claim', async () => {
  state.requestBookingResult = null;
  let result = await postBooking();
  assert.equal(result.status, 500);
  assert.ok(!JSON.stringify(result.body).includes('auto_booked'));

  state.requestBookingResult = { outcome: 'garbage', request: requestRow };
  result = await postBooking();
  assert.equal(result.status, 500);
  assert.ok(!JSON.stringify(result.body).includes('auto_booked'));
});

test('toggle is own-coach-only and boolean-validated', async () => {
  currentUser = { role: 'coach', coach: { id: COACH_ID } };
  let response = await fetch(`${baseUrl}/api/availability/auto-book`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: true }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { auto_book: true });
  // The update targeted the CALLER's coach id — no body-supplied id.
  assert.equal(state.lastCoachUpdate.id, COACH_ID);

  response = await fetch(`${baseUrl}/api/availability/auto-book`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: 'yes' }),
  });
  assert.equal(response.status, 400);

  currentUser = clientUser;
  response = await fetch(`${baseUrl}/api/availability/auto-book`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: true }),
  });
  assert.equal(response.status, 403);
});
