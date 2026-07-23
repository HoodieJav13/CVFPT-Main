const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const root = path.join(__dirname, '..', '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260720120000_coach_workout_responses.sql'),
  'utf8',
);

const IDS = {
  log: '11111111-1111-4111-8111-111111111111',
  client: '22222222-2222-4222-8222-222222222222',
  otherClient: '33333333-3333-4333-8333-333333333333',
  coach: '44444444-4444-4444-8444-444444444444',
  otherCoach: '55555555-5555-4555-8555-555555555555',
  admin: '66666666-6666-4666-8666-666666666666',
};

test('coach responses are separate, soft-state, constrained, and service-role-only', () => {
  assert.match(migration, /create table if not exists public\.workout_coach_responses/);
  assert.match(migration, /unique\(workout_log_id, author_coach_id\)/);
  assert.match(migration, /author_name_snapshot text not null check \(btrim\(author_name_snapshot\) <> ''\)/);
  assert.match(migration, /char_length\(content\) between 1 and 4000/);
  assert.match(migration, /read_at timestamptz/);
  assert.match(migration, /archived boolean not null default false/);
  assert.match(migration, /coalesce\(edited_at, created_at\) desc, id desc/);
  assert.match(migration, /alter table public\.workout_coach_responses enable row level security/);
  assert.match(migration, /revoke all privileges on table public\.workout_coach_responses from public, anon, authenticated, service_role/);
  assert.match(migration, /grant select, insert, update on table public\.workout_coach_responses to service_role/);
  assert.doesNotMatch(migration, /grant[^;]*delete/i);
  assert.doesNotMatch(migration, /alter table public\.workout_logs|update public\.workout_logs/);
  assert.doesNotMatch(migration, /notifications|client_credits/);
});

test('atomic save keeps creation-only fields and service-role execution', () => {
  assert.match(migration, /create or replace function public\.save_workout_coach_response/);
  assert.match(migration, /security invoker[\s\S]*?set search_path = ''/);
  assert.match(migration, /on conflict \(workout_log_id, author_coach_id\) do nothing/);
  assert.match(migration, /set content = v_content,[\s\S]*?edited_at = case when content is distinct from v_content/);
  assert.doesNotMatch(migration.match(/update public\.workout_coach_responses[\s\S]*?returning \* into v_response;/)?.[0] || '', /created_at|author_name_snapshot|read_at/);
  assert.match(migration, /revoke execute on function public\.save_workout_coach_response\(uuid, uuid, text\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.save_workout_coach_response\(uuid, uuid, text\) to service_role/);
});

function fakeSupabase() {
  const state = {
    calls: [],
    log: {
      id: IDS.log,
      client_id: IDS.client,
      status: 'completed',
      archived: false,
      client: { id: IDS.client, name: 'Client One', coach_id: IDS.coach, archived: false },
    },
    responses: [
      { id: 'response-b', workout_log_id: IDS.log, client_id: IDS.client, author_coach_id: IDS.otherCoach, author_name_snapshot: 'Historical Coach', content: 'Later edit', read_at: null, created_at: '2026-07-19T10:00:00.000Z', edited_at: '2026-07-20T12:00:00.000Z', archived: false },
      { id: 'response-a', workout_log_id: IDS.log, client_id: IDS.client, author_coach_id: IDS.coach, author_name_snapshot: 'Current Coach', content: 'Original response', read_at: null, created_at: '2026-07-20T11:00:00.000Z', edited_at: null, archived: false },
    ],
    rpcOutcome: 'created',
  };

  class Query {
    constructor(table) { this.table = table; this.filters = []; this.mutation = null; }
    record(method, ...args) { state.calls.push([method, this.table, ...args]); return this; }
    select(...args) { return this.record('select', ...args); }
    eq(field, value) { this.filters.push(['eq', field, value]); return this.record('eq', field, value); }
    is(field, value) { this.filters.push(['is', field, value]); return this.record('is', field, value); }
    in(field, value) { this.filters.push(['in', field, value]); return this.record('in', field, value); }
    order(...args) { return this.record('order', ...args); }
    update(value) { this.mutation = value; return this.record('update', value); }
    maybeSingle() { return Promise.resolve({ data: this.table === 'workout_logs' ? state.log : null, error: null }); }
    rows() {
      if (this.table === 'workout_log_exercises' || this.table === 'workout_log_sets') return [];
      if (this.table !== 'workout_coach_responses') return [];
      let rows = state.responses.filter((row) => this.filters.every(([kind, field, value]) => {
        if (kind === 'eq') return row[field] === value;
        if (kind === 'is') return row[field] === value;
        if (kind === 'in') return value.includes(row[field]);
        return true;
      }));
      if (this.mutation) rows.forEach((row) => Object.assign(row, this.mutation));
      return rows;
    }
    then(resolve, reject) { return Promise.resolve({ data: this.rows(), error: null }).then(resolve, reject); }
  }

  return {
    state,
    client: {
      from(table) { state.calls.push(['from', table]); return new Query(table); },
      rpc(name, args) {
        state.calls.push(['rpc', name, args]);
        return Promise.resolve({ data: { outcome: state.rpcOutcome, response: { id: 'saved-response', content: args.p_content } }, error: null });
      },
    },
  };
}

test('HTTP coach-feedback surface validates, authorizes, orders, and marks read', async (t) => {
  const supabasePath = require.resolve('../src/supabase');
  const authPath = require.resolve('../src/middleware/auth');
  const routePath = require.resolve('../src/routes/workoutLogs');
  const originals = [supabasePath, authPath, routePath].map((modulePath) => require.cache[modulePath]);
  const fake = fakeSupabase();

  const users = {
    client: { role: 'client', client: { id: IDS.client } },
    otherClient: { role: 'client', client: { id: IDS.otherClient } },
    coach: { role: 'coach', coach: { id: IDS.coach } },
    otherCoach: { role: 'coach', coach: { id: IDS.otherCoach } },
    admin: { role: 'admin', coach: { id: IDS.admin } },
  };
  const requireAuth = (req, res, next) => {
    const user = users[String(req.headers.authorization || '').replace('Bearer ', '')];
    if (!user) return res.status(401).json({ error: 'Missing authorization token' });
    req.user = user;
    return next();
  };
  const requireCoach = (req, res, next) => ['coach', 'admin'].includes(req.user?.role) ? next() : res.status(403).json({ error: 'Coach access required' });
  const requireClient = (req, res, next) => req.user?.role === 'client' ? next() : res.status(403).json({ error: 'Client access required' });
  const canAccessClient = (user, client) => user.role === 'admin' || (user.role === 'coach' && user.coach.id === client.coach_id);

  require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: { supabaseAdmin: fake.client } };
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { requireAuth, requireCoach, requireClient, canAccessClient } };
  delete require.cache[routePath];
  t.after(() => [supabasePath, authPath, routePath].forEach((modulePath, index) => {
    if (originals[index]) require.cache[modulePath] = originals[index]; else delete require.cache[modulePath];
  }));

  const app = express();
  app.use(express.json());
  app.use('/workout-logs', require(routePath));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/workout-logs`;
  const request = (pathname, { method = 'GET', token = 'coach', body } = {}) => fetch(`${base}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  await t.test('malformed content returns 400 before any database call', async () => {
    for (const body of [{}, { content: [] }, { content: {} }, { content: false }, { content: 1 }, { content: '   ' }, { content: 'x'.repeat(4001) }]) {
      fake.state.calls.length = 0;
      assert.equal((await request(`/${IDS.log}/coach-response`, { method: 'PUT', body })).status, 400);
      assert.equal(fake.state.calls.length, 0);
    }
  });

  await t.test('clients and unrelated coaches cannot author', async () => {
    fake.state.calls.length = 0;
    assert.equal((await request(`/${IDS.log}/coach-response`, { method: 'PUT', token: 'client', body: { content: 'No' } })).status, 403);
    assert.equal(fake.state.calls.length, 0);
    assert.equal((await request(`/${IDS.log}/coach-response`, { method: 'PUT', token: 'otherCoach', body: { content: 'No' } })).status, 404);
    assert.equal(fake.state.calls.some(([method]) => method === 'rpc'), false);
  });

  await t.test('active and abandoned logs reject authoring without an RPC', async () => {
    for (const status of ['active', 'abandoned']) {
      fake.state.log.status = status;
      fake.state.calls.length = 0;
      assert.equal((await request(`/${IDS.log}/coach-response`, { method: 'PUT', body: { content: 'Wait' } })).status, 409);
      assert.equal(fake.state.calls.some(([method]) => method === 'rpc'), false);
    }
    fake.state.log.status = 'completed';
  });

  await t.test('current coach create/edit uses only the server author and trimmed content', async () => {
    fake.state.calls.length = 0;
    fake.state.rpcOutcome = 'created';
    assert.equal((await request(`/${IDS.log}/coach-response`, { method: 'PUT', body: { content: '  Great work  ' } })).status, 201);
    const created = fake.state.calls.find(([method]) => method === 'rpc');
    assert.deepEqual(created.slice(2), [{ p_workout_log_id: IDS.log, p_author_coach_id: IDS.coach, p_content: 'Great work' }]);
    fake.state.rpcOutcome = 'updated';
    assert.equal((await request(`/${IDS.log}/coach-response`, { method: 'PUT', body: { content: 'Updated' } })).status, 200);
  });

  await t.test('detail returns deterministic snapshot-attributed response ordering', async () => {
    const response = await request(`/${IDS.log}`, { token: 'client' });
    assert.equal(response.status, 200);
    const detail = await response.json();
    assert.deepEqual(detail.coach_responses.map((row) => row.author_name_snapshot), ['Historical Coach', 'Current Coach']);
  });

  await t.test('unread and mark-read are client-owned and idempotent', async () => {
    let response = await request('/coach-feedback/unread-count', { token: 'client' });
    assert.deepEqual(await response.json(), { unread: 2 });
    response = await request(`/${IDS.log}/coach-feedback/read`, { method: 'PATCH', token: 'otherClient' });
    assert.equal(response.status, 404);
    assert.equal(fake.state.responses.every((row) => row.read_at === null), true);
    response = await request(`/${IDS.log}/coach-feedback/read`, { method: 'PATCH', token: 'client' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).updated, 2);
    response = await request(`/${IDS.log}/coach-feedback/read`, { method: 'PATCH', token: 'client' });
    assert.deepEqual(await response.json(), { updated: 0, read_at: null });
  });
});
