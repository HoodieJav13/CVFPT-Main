// PR120 review 4366537631: the coach swap decision route keeps its existing
// role and ownership checks, then makes ONE database call
// (decide_workout_substitution) that decides and activates atomically. Real
// Express routers on a loopback server; Supabase and auth stubbed via the
// require cache. The SQL itself is covered by supabase/tests/pr120_repairs.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { canAccessClient } = require('../src/security/access');

const EVENT = 'AAAAAAAA-1111-4111-8111-111111111111';
const SUB = '22222222-2222-4222-8222-222222222222';
let actor, log, sub, rpcCalls, updates, rpcResult, logged;
function reset() {
  actor = { role: 'coach', coach: { id: 'coach-a' } };
  log = { id: 'log-a', client_id: 'client-a', status: 'active', archived: false, client: { id: 'client-a', coach_id: 'coach-a', archived: false } };
  sub = { id: SUB, workout_log_id: 'log-a', status: 'pending_confirmation', decision_event_id: null };
  rpcCalls = []; updates = []; logged = [];
  rpcResult = { data: { outcome: 'approve', substitution: { ...sub, status: 'active' } }, error: null };
}
const dbPath = require.resolve('../src/supabase');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { supabaseAdmin: {
  rpc(name, args) { rpcCalls.push({ name, args }); return Promise.resolve(rpcResult); },
  from(table) {
    const filters = [];
    const rows = () => (table === 'workout_logs' ? [log] : table === 'workout_log_substitutions' ? [sub] : []).filter((row) => filters.every(([key, value]) => row[key] === value));
    const chain = { select() { return chain; }, eq(key, value) { filters.push([key, value]); return chain; }, in() { return chain; }, order() { return chain; },
      update(value) { updates.push({ table, value }); return chain; }, maybeSingle() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
      single() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
      then(resolve) { return resolve({ data: rows(), count: 0, error: null }); } };
    return chain;
  },
} } };
const authPath = require.resolve('../src/middleware/auth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  requireAuth(req, _res, next) { req.user = actor; next(); },
  requireCoach(req, res, next) { if (['coach', 'admin'].includes(actor.role)) next(); else res.status(403).json({ error: 'Coach access required' }); },
  requireClient(_req, _res, next) { next(); }, canAccessClient,
} };
const loggerPath = require.resolve('../src/utils/logger');
require.cache[loggerPath] = { id: loggerPath, filename: loggerPath, loaded: true, exports: { logError(context) { logged.push(context); } } };

const app = express(); app.use(express.json()); app.use('/api/workout-logs', require('../src/routes/workoutLogs'));
let server, base;
test.before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => new Promise((resolve) => server.close(resolve)));
async function decide(body) {
  const res = await fetch(`${base}/api/workout-logs/log-a/substitutions/${SUB}/decision`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
const decideCalls = () => rpcCalls.filter((call) => call.name === 'decide_workout_substitution');

test('a decision is one atomic database call with the coach and a normalized event id', async () => {
  reset();
  const response = await decide({ decision: 'approve', event_id: EVENT });
  assert.equal(response.status, 200);
  assert.equal(response.body.outcome, 'approve');
  assert.equal(response.body.substitution.status, 'active');
  assert.deepEqual(decideCalls().map((call) => call.args), [{ p_log_id: 'log-a', p_sub_id: SUB, p_decision: 'approve', p_event_id: EVENT.toLowerCase(), p_coach_id: 'coach-a' }]);
  assert.deepEqual(rpcCalls.filter((call) => call.name === 'activate_workout_substitution'), [], 'no separate activation call');
  assert.deepEqual(updates.filter((row) => row.table === 'workout_log_substitutions'), [], 'no separate decision update');
});

test('outcomes map to the existing responses', async () => {
  const cases = [
    ['decline', { outcome: 'decline', substitution: { id: SUB, status: 'declined' } }, 200],
    ['approve', { outcome: 'replayed', substitution: { id: SUB, status: 'active' } }, 200],
    ['decline', { outcome: 'already_decided', substitution: { id: SUB, status: 'active' } }, 409],
    ['approve', { outcome: 'log_not_active', substitution: { id: SUB } }, 409],
    ['approve', { outcome: 'not_found' }, 404],
  ];
  for (const [decision, data, status] of cases) {
    reset(); rpcResult = { data, error: null };
    const response = await decide({ decision, event_id: EVENT });
    assert.equal(response.status, status, `${data.outcome}: ${JSON.stringify(response.body)}`);
    if (data.outcome === 'replayed') assert.equal(response.body.outcome, 'replayed');
    if (data.outcome === 'already_decided') assert.equal(response.body.error, 'This swap was already decided.');
  }
});

test('a failing decision RPC is a controlled, logged 500', async () => {
  reset(); rpcResult = { data: null, error: { message: 'synthetic failure' } };
  const response = await decide({ decision: 'approve', event_id: EVENT });
  assert.deepEqual([response.status, response.body.error], [500, 'Failed to record the decision']);
  assert.deepEqual(logged, ['substitution decision error']);
});

test('existing role, ownership, body and lookup checks still run before any decision', async () => {
  reset(); actor = { role: 'client', client: { id: 'client-a' } };
  assert.equal((await decide({ decision: 'approve', event_id: EVENT })).status, 403);
  reset(); actor = { role: 'coach', coach: { id: 'coach-b' } };
  assert.equal((await decide({ decision: 'approve', event_id: EVENT })).status, 404);
  reset();
  assert.equal((await decide({ decision: 'maybe', event_id: EVENT })).status, 400);
  assert.equal((await decide({ decision: 'approve', event_id: 'nope' })).status, 400);
  reset(); sub.workout_log_id = 'log-other';
  assert.equal((await decide({ decision: 'approve', event_id: EVENT })).status, 404);
  assert.equal(decideCalls().length, 0);
});
