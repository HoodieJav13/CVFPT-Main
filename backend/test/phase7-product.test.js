// Phase 7 mounted-route tests: no-show transitions, client self-cancel
// cutoff, ICS files, request withdrawal, admin coach lifecycle guards, and
// the roster importer. Supabase, auth, and email are require-cache stubs.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const COACH_ID = 'aaaaaaaa-0000-0000-0000-00000000000a';
const OTHER_COACH_ID = 'abababab-0000-0000-0000-00000000000b';
const CLIENT_ID = 'cccccccc-0000-0000-0000-00000000000c';
const SESSION_ID = 'eeeeeeee-0000-0000-0000-00000000000e';
const BOOKING_ID = 'ffffffff-0000-0000-0000-00000000000f';
const HOUR = 60 * 60 * 1000;

const state = {
  sessionRow: null,
  bookingRow: null,
  coachRow: null,
  clientRow: null,
  adminCount: 0,
  clientCount: 0,
  existingEmails: [],
  insertedClients: null,
  updateUserCalls: [],
  updateUserResult: { data: {}, error: null },
  events: [],
};

function resetState() {
  state.sessionRow = null;
  state.bookingRow = null;
  state.coachRow = null;
  state.clientRow = null;
  state.adminCount = 0;
  state.clientCount = 0;
  state.existingEmails = [];
  state.insertedClients = null;
  state.updateUserCalls = [];
  state.updateUserResult = { data: {}, error: null };
  state.events = [];
}

const supabasePath = require.resolve('../src/supabase');
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: {
    supabaseAdmin: {
      from(table) {
        const chain = {
          _update: null,
          _insert: null,
          select(_cols, opts) { chain._head = Boolean(opts?.head); return chain; },
          eq() { return chain; },
          neq() { return chain; },
          in() { return chain; },
          gte() { return chain; },
          order() { return chain; },
          update(values) { chain._update = values; return chain; },
          insert(values) { chain._insert = values; return chain; },
          maybeSingle() {
            if (table === 'sessions') {
              const row = state.sessionRow;
              if (chain._update && row) return Promise.resolve({ data: { ...row, ...chain._update }, error: null });
              return Promise.resolve({ data: row, error: null });
            }
            if (table === 'booking_requests') {
              const row = state.bookingRow;
              if (chain._update && row) return Promise.resolve({ data: { ...row, ...chain._update }, error: null });
              return Promise.resolve({ data: row, error: null });
            }
            if (table === 'coaches') return Promise.resolve({ data: state.coachRow, error: null });
            if (table === 'clients') return Promise.resolve({ data: state.clientRow, error: null });
            return Promise.resolve({ data: null, error: null });
          },
          single() {
            if (table === 'sessions' && chain._update) {
              return Promise.resolve({ data: { ...state.sessionRow, ...chain._update }, error: null });
            }
            if (table === 'coaches' && chain._update) {
              return Promise.resolve({ data: { ...state.coachRow, ...chain._update }, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
          then(resolve) {
            if (chain._head && table === 'coaches') return resolve({ count: state.adminCount, error: null });
            if (chain._head && table === 'clients') return resolve({ count: state.clientCount, error: null });
            if (table === 'clients' && chain._insert) {
              state.insertedClients = chain._insert;
              return resolve({ data: chain._insert.map((row, i) => ({ id: `new-${i}`, name: row.name, email: row.email })), error: null });
            }
            if (table === 'clients') {
              return resolve({ data: state.existingEmails.map((email) => ({ email })), error: null });
            }
            return resolve({ data: [], error: null });
          },
        };
        return chain;
      },
      auth: {
        admin: {
          updateUserById(id, attrs) {
            state.updateUserCalls.push({ id, attrs });
            return Promise.resolve(state.updateUserResult);
          },
          generateLink() {
            return Promise.resolve({ data: { properties: { hashed_token: 'tok_reset_1234567890abcdef' } }, error: null });
          },
        },
      },
    },
    anonClient: () => ({ auth: {} }),
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
    requireAdmin: (req, res, next) => (req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Admin access required' })),
    canAccessClient: () => true,
  },
};

const emailPath = require.resolve('../src/services/email');
require.cache[emailPath] = {
  id: emailPath, filename: emailPath, loaded: true,
  exports: {
    configured: () => true,
    dispatchEmail: (task) => Promise.resolve().then(task),
    sendEmail: (message, key) => { state.events.push({ kind: 'send', key }); return Promise.resolve({}); },
    renderEmail: ({ headline, actionUrl }) => ({ text: `${headline} ${actionUrl}`, html: '' }),
    notifyBookingEvent: (event, payload) => { state.events.push({ kind: event, id: payload?.booking?.id }); return Promise.resolve({}); },
    notifySessionCancelled: () => Promise.resolve({}),
    notifySessionCancelledByClient: (session) => { state.events.push({ kind: 'client-cancelled', id: session.id }); return Promise.resolve({}); },
    notifySessionRescheduled: () => Promise.resolve({}),
    notifySessionScheduled: () => Promise.resolve({}),
  },
};

const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/sessions', require('../src/routes/sessions'));
app.use('/api/bookings', require('../src/routes/bookings'));
app.use('/api/admin', require('../src/routes/admin'));
app.use('/api/clients', require('../src/routes/clients'));
const server = http.createServer(app);
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); });

async function send(pathname, { method = 'PATCH', body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = response.headers.get('content-type') || '';
  return {
    status: response.status,
    type,
    body: type.includes('application/json') ? await response.json() : await response.text(),
  };
}

const coachUser = { role: 'coach', coach: { id: COACH_ID, name: 'Coach Sam' } };
const adminUser = { role: 'admin', coach: { id: COACH_ID, name: 'Admin Sam' } };
const clientUser = { role: 'client', client: { id: CLIENT_ID, coach_id: COACH_ID } };

function scheduledSession(offsetMs, overrides = {}) {
  return {
    id: SESSION_ID, client_id: CLIENT_ID, coach_id: COACH_ID,
    scheduled_at: new Date(Date.now() + offsetMs).toISOString(),
    duration_minutes: 60, location: 'CVF Studio', status: 'scheduled', archived: false,
    ...overrides,
  };
}

test('no-show: past scheduled flips, future and completed refuse', async () => {
  resetState();
  currentUser = coachUser;
  state.sessionRow = scheduledSession(-2 * HOUR);
  let result = await send(`/api/sessions/${SESSION_ID}/no-show`);
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'no_show');

  state.sessionRow = scheduledSession(2 * HOUR);
  result = await send(`/api/sessions/${SESSION_ID}/no-show`);
  assert.equal(result.status, 400);

  state.sessionRow = scheduledSession(-2 * HOUR, { status: 'completed' });
  result = await send(`/api/sessions/${SESSION_ID}/no-show`);
  assert.equal(result.status, 400);
});

test('client-cancel: allowed at 48h, refused inside 24h with the policy message', async () => {
  resetState();
  currentUser = clientUser;
  state.sessionRow = scheduledSession(48 * HOUR);
  let result = await send(`/api/sessions/${SESSION_ID}/client-cancel`);
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'cancelled');
  assert.deepEqual(state.events.filter((e) => e.kind === 'client-cancelled'), [{ kind: 'client-cancelled', id: SESSION_ID }]);

  resetState();
  currentUser = clientUser;
  state.sessionRow = scheduledSession(2 * HOUR);
  result = await send(`/api/sessions/${SESSION_ID}/client-cancel`);
  assert.equal(result.status, 400);
  assert.match(result.body.error, /24 hours/);
  assert.equal(state.events.length, 0);
});

test('client-cancel: coaches cannot use the client route; missing session masks', async () => {
  resetState();
  currentUser = coachUser;
  state.sessionRow = scheduledSession(48 * HOUR);
  let result = await send(`/api/sessions/${SESSION_ID}/client-cancel`);
  assert.equal(result.status, 403);

  currentUser = clientUser;
  state.sessionRow = null;
  result = await send(`/api/sessions/${SESSION_ID}/client-cancel`);
  assert.equal(result.status, 404);
});

test('ics: scheduled session downloads a well-formed calendar file', async () => {
  resetState();
  currentUser = clientUser;
  state.sessionRow = {
    ...scheduledSession(48 * HOUR),
    coach: { id: COACH_ID, name: 'Sam Rivera' },
    client: { id: CLIENT_ID, name: 'Jo Client' },
    location: 'Studio; Room 2, back',
  };
  const result = await send(`/api/sessions/${SESSION_ID}/ics`, { method: 'GET' });
  assert.equal(result.status, 200);
  assert.match(result.type, /text\/calendar/);
  assert.match(result.body, /BEGIN:VCALENDAR/);
  assert.match(result.body, new RegExp(`UID:cvf-session-${SESSION_ID}@cvfpt`));
  assert.match(result.body, /DTSTART:\d{8}T\d{6}Z/);
  assert.match(result.body, /SUMMARY:Training session with Sam Rivera/);
  assert.match(result.body, /LOCATION:Studio\\; Room 2\\, back/);

  state.sessionRow.status = 'completed';
  const done = await send(`/api/sessions/${SESSION_ID}/ics`, { method: 'GET' });
  assert.equal(done.status, 400);
});

test('withdraw: pending own request becomes withdrawn and notifies the coach', async () => {
  resetState();
  currentUser = clientUser;
  state.bookingRow = { id: BOOKING_ID, client_id: CLIENT_ID, coach_id: COACH_ID, status: 'pending', archived: false };
  let result = await send(`/api/bookings/${BOOKING_ID}/withdraw`);
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'withdrawn');
  assert.deepEqual(state.events, [{ kind: 'booking-withdrawn', id: BOOKING_ID }]);

  state.bookingRow = { ...state.bookingRow, status: 'approved' };
  result = await send(`/api/bookings/${BOOKING_ID}/withdraw`);
  assert.equal(result.status, 400);
});

test('coach archive guards: self, last admin, assigned clients', async () => {
  resetState();
  currentUser = adminUser;
  state.coachRow = { id: COACH_ID, name: 'Admin Sam', email: 'sam@x.com', is_admin: true, archived: false, auth_user_id: 'auth-1' };
  let result = await send(`/api/admin/coaches/${COACH_ID}/archive`, { body: { archived: true } });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /own account/);

  state.coachRow = { id: OTHER_COACH_ID, name: 'Coach B', email: 'b@x.com', is_admin: true, archived: false, auth_user_id: 'auth-2' };
  state.adminCount = 0;
  result = await send(`/api/admin/coaches/${OTHER_COACH_ID}/archive`, { body: { archived: true } });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /active admin/);

  state.coachRow = { id: OTHER_COACH_ID, name: 'Coach B', email: 'b@x.com', is_admin: false, archived: false, auth_user_id: 'auth-2' };
  state.clientCount = 3;
  result = await send(`/api/admin/coaches/${OTHER_COACH_ID}/archive`, { body: { archived: true } });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /Reassign/);

  state.clientCount = 0;
  result = await send(`/api/admin/coaches/${OTHER_COACH_ID}/archive`, { body: { archived: true } });
  assert.equal(result.status, 200);
  assert.equal(result.body.archived, true);
});

test('admin toggle refuses to demote the last active admin', async () => {
  resetState();
  currentUser = adminUser;
  state.coachRow = { id: OTHER_COACH_ID, name: 'Coach B', email: 'b@x.com', is_admin: true, archived: false, auth_user_id: 'auth-2' };
  state.adminCount = 0;
  let result = await send(`/api/admin/coaches/${OTHER_COACH_ID}/admin`, { body: { is_admin: false } });
  assert.equal(result.status, 400);

  state.adminCount = 1;
  result = await send(`/api/admin/coaches/${OTHER_COACH_ID}/admin`, { body: { is_admin: false } });
  assert.equal(result.status, 200);
  assert.equal(result.body.is_admin, false);
});

test('coach edit syncs the auth email and 409s on duplicates', async () => {
  resetState();
  currentUser = adminUser;
  state.coachRow = { id: OTHER_COACH_ID, name: 'Coach B', email: 'b@x.com', is_admin: false, archived: false, auth_user_id: 'auth-2' };
  let result = await send(`/api/admin/coaches/${OTHER_COACH_ID}`, { body: { email: 'new@x.com' } });
  assert.equal(result.status, 200);
  assert.deepEqual(state.updateUserCalls, [{ id: 'auth-2', attrs: { email: 'new@x.com', email_confirm: true } }]);

  resetState();
  currentUser = adminUser;
  state.coachRow = { id: OTHER_COACH_ID, name: 'Coach B', email: 'b@x.com', is_admin: false, archived: false, auth_user_id: 'auth-2' };
  state.updateUserResult = { data: null, error: { message: 'already been registered' } };
  result = await send(`/api/admin/coaches/${OTHER_COACH_ID}`, { body: { email: 'taken@x.com' } });
  assert.equal(result.status, 409);
});

test('roster import: dedupes and reports per-row reasons', async () => {
  resetState();
  currentUser = coachUser;
  state.existingEmails = ['existing@x.com'];
  const result = await send('/api/clients/import', {
    method: 'POST',
    body: {
      rows: [
        { name: 'Alma New', email: 'Alma@X.com', phone: '505-1', goals: 'strength' },
        { name: '', email: 'noname@x.com' },
        { name: 'Dupe InFile', email: 'alma@x.com' },
        { name: 'Already Here', email: 'existing@x.com' },
      ],
    },
  });
  assert.equal(result.status, 201);
  assert.equal(result.body.imported, 1);
  assert.equal(result.body.skipped.length, 3);
  assert.deepEqual(state.insertedClients, [{ name: 'Alma New', email: 'alma@x.com', phone: '505-1', goals: 'strength', coach_id: COACH_ID }]);
  const reasons = result.body.skipped.map((s) => s.reason);
  assert.ok(reasons.some((r) => /Name is required/.test(r)));
  assert.ok(reasons.some((r) => /Duplicate email in this file/.test(r)));
  assert.ok(reasons.some((r) => /already exists/.test(r)));
});

test('session totals count no-shows against the settled denominator', () => {
  const { sessionTotals } = require('../src/lib/analytics');
  const now = Date.now();
  const totals = sessionTotals([
    { status: 'completed', scheduled_at: new Date(now - HOUR).toISOString() },
    { status: 'completed', scheduled_at: new Date(now - HOUR).toISOString() },
    { status: 'no_show', scheduled_at: new Date(now - HOUR).toISOString() },
    { status: 'cancelled', scheduled_at: new Date(now - HOUR).toISOString() },
  ], now);
  assert.equal(totals.no_show, 1);
  assert.equal(totals.no_show_rate, 0.25);
  assert.equal(totals.cancellation_rate, 0.25);
});

test('migration widens both status constraints forward-only', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '../../supabase/migrations/20260807090000_no_show_and_withdrawn.sql'),
    'utf8',
  );
  assert.match(migration, /sessions_status_check[\s\S]*?'no_show'/);
  assert.match(migration, /booking_requests_status_check[\s\S]*?'withdrawn'/);
  assert.doesNotMatch(migration, /drop table|delete from|update /i);
});
