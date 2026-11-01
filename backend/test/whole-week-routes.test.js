// Behavioral HTTP tests for the whole-week routes over a real Express server.
// The database is a recording fake: these tests prove what the HTTP layer
// refuses before any database call, exactly what it sends to the guarded RPCs,
// and how RPC outcomes map to responses. SQL semantics (locks, receipts,
// ownership, preferences) are proven by supabase/tests/whole_week.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
const { requireCoach, requireClient } = require('../src/middleware/auth');
const { createWholeWeekRouters } = require('../src/routes/wholeWeek');

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CLIENT = id(11);
const OTHER_CLIENT = id(12);
const ACTIVITY = id(31);
const REQUEST = id(201);
// 2026-03-09T05:30Z is 23:30 on Sunday 2026-03-08 in Denver, hours after the
// spring-forward change. A UTC "today" would wrongly be Monday 2026-03-09.
const NOW = new Date('2026-03-09T05:30:00.000Z');

const USERS = {
  client: { role: 'client', authUserId: id(111), client: { id: CLIENT, coach_id: id(1) } },
  coach: { role: 'coach', authUserId: id(101), coach: { id: id(1) } },
  admin: { role: 'admin', authUserId: id(103), coach: { id: id(3), is_admin: true } },
};
const auth = {
  requireAuth(req, res, next) {
    const user = USERS[req.headers.authorization];
    if (!user) return res.status(401).json({ error: 'Missing authorization token' });
    req.user = user;
    return next();
  },
  requireCoach,
  requireClient,
};

function fakeDb({ rpc, logs } = {}) {
  const calls = [];
  const queries = [];
  return {
    calls,
    queries,
    async rpc(name, args) {
      calls.push({ name, args });
      return rpc ? rpc(name, args) : { data: null, error: null };
    },
    from(table) {
      const query = { table, filters: [], select: null, limit: null };
      queries.push(query);
      const builder = {
        select(columns) { query.select = columns; return builder; },
        eq(column, value) { query.filters.push(['eq', column, value]); return builder; },
        gte(column, value) { query.filters.push(['gte', column, value]); return builder; },
        lt(column, value) { query.filters.push(['lt', column, value]); return builder; },
        limit(count) { query.limit = count; return builder; },
        then(resolve, reject) {
          return Promise.resolve(typeof logs === 'function' ? logs(query) : (logs || { data: [], error: null })).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

async function start(t, db) {
  const routers = createWholeWeekRouters({ db, auth, now: () => NOW, writeLimiter: (_req, _res, next) => next() });
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/whole-week', routers.week);
  app.use('/api/outside-activities', routers.activities);
  app.use('/api/context-preferences', routers.preferences);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  return async (method, path, { as = 'client', body } = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: { ...(as ? { authorization: as } : {}), 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
}

const weekData = (overrides = {}) => ({
  client_id: CLIENT, viewer_role: 'client', week_start: '2026-03-02', week_end: '2026-03-08',
  preferences: { revision: 0, activity_collection: 'default_off' }, activities: [], truncated: false,
  pt_workouts: { status: 'available', completed_count: 0, by_day: {} },
  summary: { activity_count: 0, known_duration_seconds: 0, known_duration_count: 0, unknown_duration_count: 0, unknown_effort_count: 0 },
  ...overrides,
});
const createBody = (overrides = {}) => ({
  request_id: REQUEST, revision: 0, activity_type: 'game', occurred_on: '2026-03-08', ...overrides,
});
const fullFields = { activity_type: 'run', occurred_on: '2026-03-07', label: null, duration_seconds: null, effort_rpe: null, note: null };

test('capability probe needs a session and names the guarded contract', async (t) => {
  const request = await start(t, fakeDb());
  assert.equal((await request('GET', '/whole-week/capability', { as: null })).status, 401);
  const probe = await request('GET', '/whole-week/capability');
  assert.equal(probe.status, 200);
  assert.deepEqual(probe.body, { feature: 'whole_week', contract: 1, outside_activity_writes: 'guarded', preference_writes: 'guarded' });
});

test('client week read uses the verified auth id + linked client id and a Denver week across DST', async (t) => {
  const db = fakeDb({
    rpc: async () => ({ data: weekData({ pt_workouts: { status: 'available', completed_count: 3, by_day: { '2026-03-07': 1, '2026-03-08': 1, '2026-03-02': 1 } } }), error: null }),
    logs: { data: [
      { id: 'a', completed_at: '2026-03-08T06:30:00.000Z' }, // Sat 23:30 MST -> 2026-03-07
      { id: 'b', completed_at: '2026-03-09T05:30:00.000Z' }, // Sun 23:30 MDT -> 2026-03-08
      { id: 'c', completed_at: '2026-03-02T07:00:00.000Z' }, // Mon 00:00 MST -> 2026-03-02
    ], error: null },
  });
  const request = await start(t, db);
  const read = await request('GET', '/whole-week/mine');
  assert.equal(read.status, 200);
  assert.equal(read.body.today, '2026-03-08');
  assert.equal(read.body.current_week_start, '2026-03-02');
  assert.deepEqual(read.body.days, ['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08']);
  assert.deepEqual(db.calls[0], { name: 'read_whole_week', args: { p_auth_user_id: id(111), p_client_id: CLIENT, p_week_start: '2026-03-02', p_cursor: null } });
  // The auth id is never used as a client id.
  assert.notEqual(db.calls[0].args.p_client_id, db.calls[0].args.p_auth_user_id);
  assert.equal(db.queries.length, 0, 'all private reads remain inside the authorized RPC');
  assert.equal(read.body.pt_workouts.status, 'available');
  assert.equal(read.body.pt_workouts.completed_count, 3);
  assert.equal(read.body.pt_workouts.by_day['2026-03-07'], 1);
  assert.equal(read.body.pt_workouts.by_day['2026-03-08'], 1);
  assert.equal(read.body.pt_workouts.by_day['2026-03-02'], 1);
});

test('explicit week selection is strict and refused before any database call', async (t) => {
  const db = fakeDb({ rpc: async () => ({ data: weekData({ week_start: '2025-10-27', week_end: '2025-11-02' }), error: null }) });
  const request = await start(t, db);
  for (const bad of ['2026-03-03', '2026-02-30', '2026-3-02', '2026-03-09', 'monday']) {
    assert.equal((await request('GET', `/whole-week/mine?week_start=${bad}`)).status, 400, bad);
  }
  assert.equal((await request('GET', '/whole-week/mine?week_start=2026-03-02&week_start=2026-02-23')).status, 400);
  assert.equal(db.calls.length, 0);
  const fallBack = await request('GET', '/whole-week/mine?week_start=2025-10-27');
  assert.equal(fallBack.status, 200);
  assert.equal(db.calls[0].args.p_week_start, '2025-10-27');
  assert.equal(db.queries.length, 0, 'no service table read follows authorization');
});

test('coach week read is coach-only, validates the client id and masks ownership failures', async (t) => {
  let outcome = { data: weekData({ viewer_role: 'coach' }), error: null };
  const db = fakeDb({ rpc: async () => outcome });
  const request = await start(t, db);
  assert.equal((await request('GET', `/whole-week/clients/${CLIENT}`)).status, 403);
  assert.equal((await request('GET', '/whole-week/mine', { as: 'coach' })).status, 403);
  assert.equal((await request('GET', '/whole-week/clients/not-a-uuid', { as: 'coach' })).status, 404);
  assert.equal(db.calls.length, 0);
  const ok = await request('GET', `/whole-week/clients/${CLIENT}?week_start=2026-03-02`, { as: 'coach' });
  assert.equal(ok.status, 200);
  assert.deepEqual(db.calls[0].args, { p_auth_user_id: id(101), p_client_id: CLIENT, p_week_start: '2026-03-02', p_cursor: null });
  outcome = { data: null, error: { code: 'P0404', message: 'Client week not found' } };
  const masked = await request('GET', `/whole-week/clients/${OTHER_CLIENT}`, { as: 'coach' });
  assert.deepEqual(masked, { status: 404, body: { error: 'Client week not found' } });
  assert.equal(db.queries.length, 0, 'no service table read after an ownership refusal');
});

test('read failures are errors, never an empty successful week; a workout read failure is reported as partial', async (t) => {
  let outcome = { data: null, error: { code: 'XX000', message: 'connection reset' } };
  let logs = { data: null, error: { message: 'timeout' } };
  const db = fakeDb({ rpc: async () => outcome, logs: () => logs });
  const request = await start(t, db);
  const failed = await request('GET', '/whole-week/mine');
  assert.equal(failed.status, 500);
  assert.equal(failed.body.activities, undefined);
  assert.match(failed.body.error, /Could not load this week/);
  outcome = { data: null, error: { code: '42883', message: 'function read_whole_week does not exist' } };
  assert.equal((await request('GET', '/whole-week/mine')).status, 503);
  outcome = { data: weekData({ activities: [{ id: ACTIVITY, occurred_on: '2026-03-04', duration_seconds: null }], pt_workouts: { status: 'unavailable', completed_count: null, by_day: null } }), error: null };
  const partial = await request('GET', '/whole-week/mine');
  assert.equal(partial.status, 200);
  assert.equal(partial.body.activities.length, 1);
  assert.deepEqual(partial.body.pt_workouts, { status: 'unavailable', completed_count: null, by_day: null });
  outcome = { data: weekData(), error: null };
  const empty = await request('GET', '/whole-week/mine');
  assert.equal(empty.body.pt_workouts.status, 'available');
  assert.equal(empty.body.pt_workouts.completed_count, 0);
});

test('create normalizes a strict body; unknown duration/effort stay null and invalid input never reaches the RPC', async (t) => {
  const resource = { id: ACTIVITY, revision: 1, occurred_on: '2026-03-08' };
  const db = fakeDb({ rpc: async () => ({ data: { resource, committed_revision: 1, request_id: REQUEST, replayed: false, action: 'create' }, error: null }) });
  const request = await start(t, db);
  const invalid = [
    createBody({ revision: 1 }), createBody({ request_id: 'nope' }), createBody({ activity_type: 'nap' }),
    createBody({ occurred_on: '2026-02-30' }), createBody({ occurred_on: '2026-03-09' }), createBody({ occurred_on: '2026-3-8' }),
    createBody({ duration_seconds: 0 }), createBody({ duration_seconds: 86401 }), createBody({ duration_seconds: 90.5 }), createBody({ duration_seconds: '3600' }),
    createBody({ effort_rpe: 0 }), createBody({ effort_rpe: 11 }), createBody({ effort_rpe: 7.5 }),
    createBody({ label: 'x'.repeat(81) }), createBody({ note: 'n'.repeat(1001) }), createBody({ note: 42 }),
    createBody({ client_id: OTHER_CLIENT }), createBody({ created_by_role: 'coach' }), createBody({ coach_id: id(2) }),
    [createBody()],
  ];
  for (const body of invalid) assert.equal((await request('POST', '/outside-activities/mine', { body })).status, 400, JSON.stringify(body).slice(0, 80));
  assert.equal((await request('POST', '/outside-activities/mine', { body: createBody({ note: 'n'.repeat(900), label: 'y'.repeat(80), extra: 'z'.repeat(17000) }) })).status, 413);
  assert.equal(db.calls.length, 0);

  const created = await request('POST', '/outside-activities/mine', { body: createBody({ label: '  Club soccer  ', note: '   ', duration_seconds: 3600 }) });
  assert.equal(created.status, 201);
  assert.deepEqual(db.calls[0], {
    name: 'mutate_outside_activity',
    args: {
      p_auth_user_id: id(111), p_client_id: CLIENT, p_activity_id: null,
      p_request: {
        action: 'create', request_id: REQUEST, revision: 0,
        fields: { activity_type: 'game', occurred_on: '2026-03-08', label: 'Club soccer', duration_seconds: 3600, effort_rpe: null, note: null },
      },
    },
  });
  // Explicit nulls and omitted optional fields normalize identically (same frozen body).
  await request('POST', '/outside-activities/mine', { body: createBody({ label: null, duration_seconds: null, effort_rpe: null, note: null }) });
  await request('POST', '/outside-activities/mine', { body: createBody() });
  assert.deepEqual(db.calls[1].args.p_request, db.calls[2].args.p_request);
  // A historical Denver DST date is accepted unchanged.
  await request('POST', '/outside-activities/mine', { body: createBody({ occurred_on: '2025-11-02' }) });
  assert.equal(db.calls[3].args.p_request.fields.occurred_on, '2025-11-02');
});

test('replay responses report the receipt revision separately from the latest row', async (t) => {
  const db = fakeDb({ rpc: async () => ({ data: { resource: { id: ACTIVITY, revision: 3 }, committed_revision: 1, request_id: REQUEST, replayed: true, action: 'create' }, error: null }) });
  const request = await start(t, db);
  const replay = await request('POST', '/outside-activities/mine', { body: createBody() });
  assert.equal(replay.status, 200, 'a replay is not a new create');
  assert.equal(replay.body.committed_revision, 1);
  assert.equal(replay.body.resource.revision, 3);
  assert.equal(replay.body.replayed, true);
});

test('coach creates on behalf through the client-scoped route; roles cannot cross routes', async (t) => {
  const db = fakeDb({ rpc: async () => ({ data: { resource: { id: ACTIVITY, revision: 1 }, committed_revision: 1, request_id: REQUEST, replayed: false, action: 'create' }, error: null }) });
  const request = await start(t, db);
  assert.equal((await request('POST', `/outside-activities/clients/${CLIENT}`, { body: createBody() })).status, 403);
  assert.equal((await request('POST', '/outside-activities/mine', { as: 'coach', body: createBody() })).status, 403);
  assert.equal((await request('POST', '/outside-activities/mine', { as: null, body: createBody() })).status, 401);
  assert.equal((await request('POST', '/outside-activities/clients/bad', { as: 'coach', body: createBody() })).status, 404);
  assert.equal(db.calls.length, 0);
  assert.equal((await request('POST', `/outside-activities/clients/${CLIENT}`, { as: 'admin', body: createBody() })).status, 201);
  assert.equal(db.calls[0].args.p_auth_user_id, id(103));
  assert.equal(db.calls[0].args.p_client_id, CLIENT);
});

test('corrections require a nonempty patch and positive revision; archive is strict', async (t) => {
  const db = fakeDb({ rpc: async (_name, args) => ({ data: { resource: { id: ACTIVITY, revision: 2 }, committed_revision: 2, request_id: REQUEST, replayed: false, action: args.p_request.action }, error: null }) });
  const request = await start(t, db);
  const partial = { request_id: REQUEST, revision: 1 };
  assert.equal((await request('PATCH', `/outside-activities/${ACTIVITY}`, { body: partial })).status, 400);
  assert.equal((await request('PATCH', `/outside-activities/${ACTIVITY}`, { body: { request_id: REQUEST, revision: 0, ...fullFields } })).status, 400);
  assert.equal((await request('PATCH', `/outside-activities/${ACTIVITY}`, { body: { request_id: REQUEST, revision: 1, ...fullFields, client_id: OTHER_CLIENT } })).status, 400);
  assert.equal((await request('PATCH', `/outside-activities/${ACTIVITY}/archive`, { body: { request_id: REQUEST, revision: 1, archived: true } })).status, 400);
  assert.equal((await request('PATCH', '/outside-activities/not-a-uuid', { body: { request_id: REQUEST, revision: 1, ...fullFields } })).status, 404);
  assert.equal(db.calls.length, 0);
  const updated = await request('PATCH', `/outside-activities/${ACTIVITY}`, { as: 'coach', body: { request_id: REQUEST, revision: 1, ...fullFields, duration_seconds: 1800 } });
  assert.equal(updated.status, 200);
  assert.deepEqual(db.calls[0].args, {
    p_auth_user_id: id(101), p_client_id: null, p_activity_id: ACTIVITY,
    p_request: { action: 'update', request_id: REQUEST, revision: 1, fields: { ...fullFields, duration_seconds: 1800 } },
  });
  const archived = await request('PATCH', `/outside-activities/${ACTIVITY}/archive`, { body: { request_id: id(202), revision: 2 } });
  assert.equal(archived.status, 200);
  assert.deepEqual(db.calls[1].args.p_request, { action: 'archive', request_id: id(202), revision: 2 });
});

test('RPC refusals map to HTTP without leaking details; uncertainty is a 5xx, never a denial', async (t) => {
  let outcome;
  const db = fakeDb({ rpc: async () => outcome });
  const request = await start(t, db);
  const cases = [
    [{ code: 'P0409', message: 'This request id was already used for a different change', hint: 'request_mismatch' }, 409, 'request_mismatch'],
    [{ code: 'P0409', message: 'This activity changed elsewhere. Reload before saving', hint: 'revision_conflict' }, 409, 'revision_conflict'],
    [{ code: 'P0409', message: 'Outside activity logging is turned off by the client', hint: 'collection_off' }, 409, 'collection_off'],
    [{ code: 'P0409', message: 'This activity was removed. Reload the week', hint: 'archived' }, 409, 'archived'],
    [{ code: 'P0409', message: 'Other conflict', hint: 'internal detail' }, 409, undefined],
    [{ code: 'P0404', message: 'Activity not found' }, 404, undefined],
    [{ code: 'P0403', message: 'Coach access required' }, 403, undefined],
    [{ code: 'P0400', message: 'Choose a real calendar date' }, 400, undefined],
    [{ code: 'PGRST202', message: 'Could not find function' }, 503, undefined],
  ];
  for (const [error, status, code] of cases) {
    outcome = { data: null, error };
    const response = await request('PATCH', `/outside-activities/${ACTIVITY}`, { body: { request_id: REQUEST, revision: 1, ...fullFields } });
    assert.equal(response.status, status, error.message);
    assert.equal(response.body.code, code);
  }
  outcome = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout', details: 'secret detail' } };
  const unknown = await request('POST', '/outside-activities/mine', { body: createBody() });
  assert.equal(unknown.status, 500);
  assert.match(unknown.body.error, /Retry the same save/);
  assert.doesNotMatch(JSON.stringify(unknown.body), /secret detail|statement timeout/);
});

test('preferences are role-separated before the RPC; each role only changes its own bits', async (t) => {
  const db = fakeDb({ rpc: async () => ({ data: { preferences: { revision: 1 } }, error: null }) });
  const request = await start(t, db);
  assert.equal((await request('PATCH', '/context-preferences/mine', { body: { revision: 0, activity_coach_enabled: true } })).status, 403);
  assert.equal((await request('PATCH', `/context-preferences/clients/${CLIENT}`, { as: 'coach', body: { revision: 0, activity_client_off: false } })).status, 403);
  assert.equal((await request('PATCH', `/context-preferences/clients/${CLIENT}`, { as: 'admin', body: { revision: 0, activity_client_off: false } })).status, 403);
  assert.equal((await request('PATCH', '/context-preferences/mine', { body: { revision: 0, activity_client_off: 'yes' } })).status, 400);
  assert.equal((await request('PATCH', '/context-preferences/mine', { body: { revision: -1, activity_client_off: true } })).status, 400);
  assert.equal((await request('PATCH', '/context-preferences/mine', { body: { revision: 0 } })).status, 400);
  assert.equal((await request('PATCH', '/context-preferences/mine', { as: 'coach', body: { revision: 0, activity_client_off: true } })).status, 403);
  assert.equal(db.calls.length, 0);
  assert.equal((await request('PATCH', '/context-preferences/mine', { body: { revision: 2, activity_client_off: true } })).status, 200);
  assert.deepEqual(db.calls[0], { name: 'save_context_preferences', args: { p_auth_user_id: id(111), p_client_id: CLIENT, p_request: { revision: 2, activity_client_off: true } } });
  assert.equal((await request('PATCH', `/context-preferences/clients/${CLIENT}`, { as: 'coach', body: { revision: 0, activity_coach_enabled: true, checkin_prompt_coach_enabled: true } })).status, 200);
  assert.deepEqual(db.calls[1].args.p_request, { revision: 0, activity_coach_enabled: true, checkin_prompt_coach_enabled: true });
});

test('partial correction forwards only supplied fields, preserving omission versus null', async (t) => {
  const db = fakeDb({ rpc: async () => ({ data: { action: 'update' }, error: null }) });
  const request = await start(t, db);
  assert.equal((await request('PATCH', `/outside-activities/${ACTIVITY}`, { body: { request_id: REQUEST, revision: 2, note: null } })).status, 200);
  assert.deepEqual(db.calls[0].args.p_request.fields, { note: null });
});


test('paging cursor is strict, scoped to client/week and passed into the same authorized RPC', async(t)=>{
 const db=fakeDb({rpc:async()=>({data:weekData(),error:null})});const request=await start(t,db);
 const cursor={client_id:CLIENT,week_start:'2026-03-02',occurred_on:'2026-03-03',id:ACTIVITY};
 for(const bad of ['bad','null','{}',JSON.stringify({...cursor,client_id:OTHER_CLIENT}),JSON.stringify({...cursor,week_start:'2026-02-23'}),JSON.stringify({...cursor,occurred_on:'2026-02-30'}),JSON.stringify({...cursor,id:'not-a-uuid'}),JSON.stringify({...cursor,extra:true})]) {
  assert.equal((await request('GET','/whole-week/mine?week_start=2026-03-02&cursor='+encodeURIComponent(bad))).status,400);
 }
 assert.equal(db.calls.length,0);
 assert.equal((await request('GET','/whole-week/mine?week_start=2026-03-02&cursor='+encodeURIComponent(JSON.stringify(cursor)))).status,200);
 assert.deepEqual(db.calls[0].args.p_cursor,cursor);assert.equal(db.queries.length,0);
});
