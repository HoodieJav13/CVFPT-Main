const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const COACH_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_COACH_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CLIENT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const SESSION_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const BOOKING_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const NOTE_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const FUTURE_DATE = '2099-01-01T10:00:00.000Z';

function fakeSupabase() {
  const state = { calls: [], rows: {} };

  class Query {
    constructor(table) {
      this.table = table;
    }

    record(method, ...args) {
      state.calls.push([method, this.table, ...args]);
      return this;
    }

    select(...args) { return this.record('select', ...args); }
    insert(...args) { return this.record('insert', ...args); }
    update(...args) { return this.record('update', ...args); }
    eq(...args) { return this.record('eq', ...args); }
    gte(...args) { return this.record('gte', ...args); }
    lt(...args) { return this.record('lt', ...args); }
    in(...args) { return this.record('in', ...args); }
    order(...args) { return this.record('order', ...args); }

    result() {
      return { data: state.rows[this.table] ?? null, error: null };
    }

    maybeSingle() { return Promise.resolve(this.result()); }
    single() { return Promise.resolve(this.result()); }
    then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); }
  }

  return {
    state,
    client: {
      from(table) {
        state.calls.push(['from', table]);
        return new Query(table);
      },
      rpc(name, args) {
        state.calls.push(['rpc', name, args]);
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
}

function mutationCalls(calls) {
  return calls.filter(([method]) => ['insert', 'update', 'rpc'].includes(method));
}

test('session and booking routes reject malformed input before service-role mutations', async (t) => {
  const supabasePath = require.resolve('../src/supabase');
  const authPath = require.resolve('../src/middleware/auth');
  const sessionsPath = require.resolve('../src/routes/sessions');
  const bookingsPath = require.resolve('../src/routes/bookings');
  const originalSupabase = require.cache[supabasePath];
  const originalAuth = require.cache[authPath];
  const originalSessions = require.cache[sessionsPath];
  const originalBookings = require.cache[bookingsPath];
  const fake = fakeSupabase();

  const requireAuth = (req, res, next) => {
    const token = req.headers.authorization;
    if (!token) return res.status(401).json({ error: 'Missing authorization token' });
    if (token === 'Bearer client') {
      req.user = { role: 'client', client: { id: CLIENT_ID, coach_id: COACH_ID } };
    } else {
      req.user = { role: 'coach', coach: { id: COACH_ID } };
    }
    return next();
  };
  const requireCoach = (req, res, next) => (
    req.user?.role === 'coach' || req.user?.role === 'admin'
      ? next()
      : res.status(403).json({ error: 'Coach access required' })
  );
  const requireClient = (req, res, next) => (
    req.user?.role === 'client' ? next() : res.status(403).json({ error: 'Client access required' })
  );

  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: { supabaseAdmin: fake.client },
  };
  require.cache[authPath] = {
    id: authPath,
    filename: authPath,
    loaded: true,
    exports: {
      requireAuth,
      requireCoach,
      requireClient,
      canAccessClient: (user, client) => user.role === 'admin' || client.coach_id === user.coach.id,
    },
  };
  delete require.cache[sessionsPath];
  delete require.cache[bookingsPath];

  t.after(() => {
    if (originalSupabase) require.cache[supabasePath] = originalSupabase;
    else delete require.cache[supabasePath];
    if (originalAuth) require.cache[authPath] = originalAuth;
    else delete require.cache[authPath];
    if (originalSessions) require.cache[sessionsPath] = originalSessions;
    else delete require.cache[sessionsPath];
    if (originalBookings) require.cache[bookingsPath] = originalBookings;
    else delete require.cache[bookingsPath];
  });

  const app = express();
  app.use(express.json());
  app.use('/sessions', require(sessionsPath));
  app.use('/bookings', require(bookingsPath));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const request = (pathname, { method = 'GET', body, token = 'coach' } = {}) => fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  await t.test('role guards still reject unauthenticated and wrong-role callers', async () => {
    assert.equal((await request('/sessions?status=invalid', { token: null })).status, 401);
    assert.equal((await request('/sessions?status=invalid', { token: 'client' })).status, 403);
    assert.equal((await request('/bookings', { method: 'POST', body: {}, token: 'coach' })).status, 403);
  });

  await t.test('malformed identifiers and list filters return 400 without database access', async () => {
    for (const pathname of [
      '/sessions?client_id=not-a-uuid',
      '/sessions?from=not-a-date',
      '/sessions?status=pending',
      '/bookings?status=scheduled',
      '/sessions/not-a-uuid/cancel',
      '/sessions/notes/not-a-uuid',
      '/bookings/not-a-uuid/approve',
    ]) {
      fake.state.calls.length = 0;
      const method = pathname.includes('/notes/') ? 'PUT' : (pathname.includes('cancel') || pathname.includes('approve') ? 'PATCH' : 'GET');
      assert.equal((await request(pathname, { method, ...(method === 'PUT' ? { body: {} } : {}) })).status, 400);
      assert.equal(fake.state.calls.length, 0, pathname);
    }

    fake.state.calls.length = 0;
    const response = await request('/sessions', {
      method: 'POST',
      body: { client_id: 'not-a-uuid', scheduled_at: FUTURE_DATE, duration_minutes: 60 },
    });
    assert.equal(response.status, 400);
    assert.equal(fake.state.calls.length, 0);
  });

  await t.test('schedule and optional text fields reject type coercion before inserts', async () => {
    const sessionBodies = [
      { client_id: CLIENT_ID, scheduled_at: [FUTURE_DATE], duration_minutes: 60 },
      { client_id: CLIENT_ID, scheduled_at: FUTURE_DATE, duration_minutes: '60' },
      { client_id: CLIENT_ID, scheduled_at: FUTURE_DATE, duration_minutes: 60, location: { name: 'Studio' } },
    ];
    for (const body of sessionBodies) {
      fake.state.calls.length = 0;
      assert.equal((await request('/sessions', { method: 'POST', body })).status, 400);
      assert.equal(mutationCalls(fake.state.calls).length, 0);
    }

    fake.state.rows.sessions = { id: SESSION_ID, coach_id: COACH_ID, archived: false };
    fake.state.calls.length = 0;
    assert.equal((await request(`/sessions/${SESSION_ID}`, {
      method: 'PUT',
      body: { location: { name: 'Studio' } },
    })).status, 400);
    assert.equal(mutationCalls(fake.state.calls).length, 0);

    const bookingBodies = [
      { requested_time: [FUTURE_DATE], duration_minutes: 60 },
      { requested_time: FUTURE_DATE, duration_minutes: '60' },
      { requested_time: FUTURE_DATE, duration_minutes: 60, location: { name: 'Studio' } },
      { requested_time: FUTURE_DATE, duration_minutes: 60, note: ['Morning'] },
    ];
    for (const body of bookingBodies) {
      fake.state.calls.length = 0;
      assert.equal((await request('/bookings', { method: 'POST', body, token: 'client' })).status, 400);
      assert.equal(mutationCalls(fake.state.calls).length, 0);
    }
  });

  await t.test('session notes reject empty updates, non-text content, and non-boolean sharing', async () => {
    fake.state.rows.sessions = { id: SESSION_ID, coach_id: COACH_ID, archived: false };
    for (const body of [
      { content: 123 },
      { content: 'Ready', shared_with_client: 'false' },
    ]) {
      fake.state.calls.length = 0;
      assert.equal((await request(`/sessions/${SESSION_ID}/notes`, { method: 'POST', body })).status, 400);
      assert.equal(mutationCalls(fake.state.calls).length, 0);
    }

    fake.state.rows.session_notes = {
      id: NOTE_ID,
      archived: false,
      session: { coach_id: COACH_ID, archived: false },
    };
    for (const body of [{}, { content: '   ' }, { shared_with_client: 'false' }]) {
      fake.state.calls.length = 0;
      assert.equal((await request(`/sessions/notes/${NOTE_ID}`, { method: 'PUT', body })).status, 400);
      assert.equal(mutationCalls(fake.state.calls).length, 0);
    }
  });

  await t.test('valid foreign records remain ownership-masked and unmodified', async () => {
    fake.state.rows.sessions = { id: SESSION_ID, coach_id: OTHER_COACH_ID, archived: false };
    fake.state.calls.length = 0;
    assert.equal((await request(`/sessions/${SESSION_ID}/cancel`, { method: 'PATCH' })).status, 404);
    assert.equal(mutationCalls(fake.state.calls).length, 0);

    fake.state.rows.booking_requests = { id: BOOKING_ID, coach_id: OTHER_COACH_ID, archived: false, status: 'pending' };
    fake.state.calls.length = 0;
    assert.equal((await request(`/bookings/${BOOKING_ID}/approve`, { method: 'PATCH' })).status, 404);
    assert.equal(mutationCalls(fake.state.calls).length, 0);

    fake.state.rows.session_notes = {
      id: NOTE_ID,
      archived: false,
      session: { coach_id: OTHER_COACH_ID, archived: false },
    };
    fake.state.calls.length = 0;
    assert.equal((await request(`/sessions/notes/${NOTE_ID}`, {
      method: 'PUT',
      body: { shared_with_client: true },
    })).status, 404);
    assert.equal(mutationCalls(fake.state.calls).length, 0);
  });
});
