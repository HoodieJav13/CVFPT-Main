// Mounted-route tests for GET /api/sessions/studio: the real router runs
// on a real HTTP server, with the Supabase client and auth middleware
// stubbed through the require cache (each test file runs in its own
// process, so the stubs cannot leak). These prove the D1 privacy
// behavior end to end at the HTTP boundary rather than by source regex.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const COACH_A = 'aaaaaaaa-0000-0000-0000-00000000000a';
const COACH_B = 'bbbbbbbb-0000-0000-0000-00000000000b';

const fixtures = [
  {
    id: 's1',
    coach_id: COACH_A,
    scheduled_at: '2026-08-03T16:00:00+00:00',
    duration_minutes: 60,
    location: 'CVF Studio',
    status: 'scheduled',
    coach: { id: COACH_A, name: 'Coach A' },
    client: { id: 'c1', name: 'Alice Own', coach_id: COACH_A },
  },
  {
    id: 's2',
    coach_id: COACH_B,
    scheduled_at: '2026-08-03T17:00:00+00:00',
    duration_minutes: 45,
    location: 'CVF Studio',
    status: 'scheduled',
    coach: { id: COACH_B, name: 'Coach B' },
    client: { id: 'c2', name: 'Frank Foreign', coach_id: COACH_B },
  },
  {
    id: 's3',
    coach_id: COACH_B,
    scheduled_at: '2026-09-20T17:00:00+00:00', // outside every queried week
    duration_minutes: 60,
    location: 'CVF Studio',
    status: 'scheduled',
    coach: { id: COACH_B, name: 'Coach B' },
    client: { id: 'c3', name: 'Olivia Outside', coach_id: COACH_B },
  },
];

let currentUser;

const supabasePath = require.resolve('../src/supabase');
require.cache[supabasePath] = {
  id: supabasePath,
  filename: supabasePath,
  loaded: true,
  exports: {
    supabaseAdmin: {
      from() {
        const chain = {
          select() { return chain; },
          eq() { return chain; },
          neq() { return chain; },
          gte(column, value) { chain._gte = value; return chain; },
          lt(column, value) { chain._lt = value; return chain; },
          order() { return chain; },
          then(resolve) {
            const rows = fixtures.filter((row) => (
              (!chain._gte || new Date(row.scheduled_at) >= new Date(chain._gte))
              && (!chain._lt || new Date(row.scheduled_at) < new Date(chain._lt))
            ));
            resolve({ data: rows, error: null });
          },
        };
        return chain;
      },
    },
  },
};

const authPath = require.resolve('../src/middleware/auth');
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    requireAuth: (req, _res, next) => { req.user = currentUser; next(); },
    requireCoach: (req, res, next) => (
      req.user?.role === 'coach' || req.user?.role === 'admin'
        ? next()
        : res.status(403).json({ error: 'Coach access required' })
    ),
    requireAdmin: (_req, _res, next) => next(),
    requireClient: (_req, _res, next) => next(),
    canAccessClient: () => true,
  },
};

const express = require('express');
const sessionsRouter = require('../src/routes/sessions');

const app = express();
app.use(express.json());
app.use('/api/sessions', sessionsRouter);
const server = http.createServer(app);
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); });

const WEEK = 'from=2026-08-03T00:00:00.000Z&to=2026-08-10T00:00:00.000Z';

async function getStudio(user, query = WEEK) {
  currentUser = user;
  const response = await fetch(`${baseUrl}/api/sessions/studio?${query}`);
  return { status: response.status, body: await response.json() };
}

const coachA = { role: 'coach', coach: { id: COACH_A } };

test('range is required and must be sane', async () => {
  assert.equal((await getStudio(coachA, '')).status, 400);
  assert.equal((await getStudio(coachA, 'from=2026-08-03T00:00:00Z')).status, 400);
  assert.equal((await getStudio(coachA, 'from=2026-08-10T00:00:00Z&to=2026-08-03T00:00:00Z')).status, 400);
  assert.equal((await getStudio(coachA, 'from=2026-01-01T00:00:00Z&to=2026-12-01T00:00:00Z')).status, 400);
});

test('coach sees own client named, foreign client fully masked', async () => {
  const { status, body } = await getStudio(coachA);
  assert.equal(status, 200);
  assert.equal(body.length, 2); // s3 is outside the requested week
  const own = body.find((row) => row.id === 's1');
  assert.equal(own.masked, false);
  assert.equal(own.client.name, 'Alice Own');
  const foreign = body.find((row) => row.id === 's2');
  assert.equal(foreign.masked, true);
  assert.equal(foreign.client, null);
  // Busy-block facts stay visible…
  assert.equal(foreign.coach.name, 'Coach B');
  assert.equal(foreign.duration_minutes, 45);
  assert.equal(foreign.location, 'CVF Studio');
  assert.equal(foreign.status, 'scheduled');
  // …and the foreign client's identity appears nowhere in the payload.
  assert.ok(!JSON.stringify(body).includes('Frank Foreign'));
  assert.ok(!JSON.stringify(body).includes('"c2"'));
});

test('admin sees every client named, nothing masked', async () => {
  const { status, body } = await getStudio({ role: 'admin', coach: { id: 'cccccccc-0000-0000-0000-00000000000c' } });
  assert.equal(status, 200);
  assert.equal(body.length, 2);
  assert.ok(body.every((row) => row.masked === false && row.client?.name));
});

test('client role is rejected', async () => {
  const { status } = await getStudio({ role: 'client', client: { id: 'c1' } });
  assert.equal(status, 403);
});
