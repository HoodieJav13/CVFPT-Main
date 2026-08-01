const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const CLIENT_ID = 'cccccccc-0000-4000-8000-00000000000c';
const COACH_ID = 'aaaaaaaa-0000-4000-8000-00000000000a';
const state = { preferences: { clients: false, coaches: false }, inserts: [], updates: [], duplicate: false };

const supabasePath = require.resolve('../src/supabase');
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: {
    supabaseAdmin: {
      from(table) {
        const chain = {
          _table: table, _id: null, _update: null,
          select() { return chain; },
          eq(col, value) { if (col === 'id') chain._id = value; return chain; },
          update(value) { chain._update = value; state.updates.push({ table, value }); return chain; },
          insert(value) {
            state.inserts.push({ table, value });
            return Promise.resolve({ error: state.duplicate ? { code: '23505' } : null });
          },
          maybeSingle() {
            if (chain._update) state.preferences[table] = chain._update.digest_opt_out;
            return Promise.resolve({ data: { digest_opt_out: state.preferences[table] }, error: null });
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
  exports: { requireAuth: (req, _res, next) => { req.user = currentUser; next(); } },
};

const express = require('express');
const emailPreferences = require('../src/routes/emailPreferences');
const telemetry = require('../src/routes/telemetry').router;
const app = express();
app.use(express.json());
app.use('/api/email-preferences', emailPreferences);
app.use('/api/telemetry', telemetry);
const server = http.createServer(app);
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('email preference reads and writes only the authenticated client row', async () => {
  currentUser = { role: 'client', client: { id: CLIENT_ID, coach_id: COACH_ID } };
  let response = await fetch(`${baseUrl}/api/email-preferences`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { digest_opt_out: false });
  response = await fetch(`${baseUrl}/api/email-preferences`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ digest_opt_out: true }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { digest_opt_out: true });
  assert.deepEqual(state.updates.at(-1), { table: 'clients', value: { digest_opt_out: true } });
});

test('email preference rejects coercion before any mutation', async () => {
  const before = state.updates.length;
  const response = await fetch(`${baseUrl}/api/email-preferences`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ digest_opt_out: 'yes' }),
  });
  assert.equal(response.status, 400);
  assert.equal(state.updates.length, before);
});

test('telemetry derives identity server-side and strips arbitrary properties', async () => {
  currentUser = { role: 'client', client: { id: CLIENT_ID, coach_id: COACH_ID } };
  const response = await fetch(`${baseUrl}/api/telemetry/events`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event_id: '11111111-1111-4111-8111-111111111111', event_name: 'workout_completed',
      occurred_at: new Date().toISOString(), coach_id: 'forged', client_id: 'forged',
      properties: { route: '/client/workouts/1', offline: true, message: 'private' },
    }),
  });
  assert.equal(response.status, 202);
  const insert = state.inserts.at(-1);
  assert.equal(insert.table, 'product_events');
  assert.equal(insert.value.client_id, CLIENT_ID);
  assert.equal(insert.value.coach_id, COACH_ID);
  assert.deepEqual(insert.value.properties, { route: '/client/workouts', offline: true });
});

test('telemetry rejects unknown events and stale timestamps before database access', async () => {
  const before = state.inserts.length;
  let response = await fetch(`${baseUrl}/api/telemetry/events`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event_id: '22222222-2222-4222-8222-222222222222', event_name: 'steal_data', occurred_at: new Date().toISOString() }),
  });
  assert.equal(response.status, 400);
  response = await fetch(`${baseUrl}/api/telemetry/events`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event_id: '33333333-3333-4333-8333-333333333333', event_name: 'workout_started', occurred_at: '2020-01-01T00:00:00Z' }),
  });
  assert.equal(response.status, 400);
  assert.equal(state.inserts.length, before);
});

test('telemetry duplicate event IDs are idempotent', async () => {
  state.duplicate = true;
  const response = await fetch(`${baseUrl}/api/telemetry/events`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event_id: '44444444-4444-4444-8444-444444444444', event_name: 'message_replied', occurred_at: new Date().toISOString() }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { accepted: true, duplicate: true });
  state.duplicate = false;
});
