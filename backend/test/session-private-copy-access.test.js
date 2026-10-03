// Private workout copies attached to sessions follow the copy's client and that
// client's CURRENT coach — never the coach recorded when the copy was cloned.
// Scenario (all fictional): client "Moved" was coached by A, has a private copy
// cloned while A coached them, and an admin has since reassigned them to B.
// Mounted sessions + series routers over an in-memory database that honours
// column lists and nested embeds; email and push are stubbed (nothing is sent).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const id = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const COACH_A = id('aaaaaaaa', 1); // former coach of Moved
const COACH_B = id('bbbbbbbb', 2); // current coach of Moved
const COACH_C = id('cccccccc', 3); // unrelated coach
const ADMIN = id('dddddddd', 4);
const MOVED = id('10000000', 1); // reassigned A -> B
const A_OTHER = id('10000000', 2); // still coached by A
const C_CLIENT = id('10000000', 3);
const TEMPLATE = id('20000000', 1); // shared template authored by C
const COPY = id('20000000', 2); // Moved's private copy, stamped with coach A at clone time
const A_OTHER_COPY = id('20000000', 3); // A_OTHER's own private copy
const PROGRAM_TEMPLATE = id('30000000', 1);
const PROGRAM_COPY = id('30000000', 2); // Moved's private program, stamped with coach A
const S_HIST = id('40000000', 1); // A's session with Moved, copy attached before the reassignment
const S_LEGACY = id('40000000', 2); // A's session with A_OTHER carrying Moved's copy (pre-fix attachment)
const S_A = id('40000000', 3); // A's session with A_OTHER, nothing attached
const S_B = id('40000000', 4); // B's session with Moved, nothing attached
const S_C = id('40000000', 5); // C's session with C_CLIENT

const FUTURE = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
const SECRETS = ['Moved private day', 'Private split squat', 'Private cue'];

function seed() {
  const session = (sessionId, coachId, clientId, workoutId) => ({
    id: sessionId, coach_id: coachId, client_id: clientId, workout_id: workoutId, series_id: null,
    scheduled_at: FUTURE, duration_minutes: 60, location: 'Studio', status: 'scheduled', archived: false,
  });
  return {
    coaches: [
      { id: COACH_A, name: 'Coach A' }, { id: COACH_B, name: 'Coach B' },
      { id: COACH_C, name: 'Coach C' }, { id: ADMIN, name: 'Admin' },
    ],
    clients: [
      { id: MOVED, coach_id: COACH_B, name: 'Moved Client', archived: false },
      { id: A_OTHER, coach_id: COACH_A, name: 'Other Client of A', archived: false },
      { id: C_CLIENT, coach_id: COACH_C, name: 'Client of C', archived: false },
    ],
    workouts: [
      { id: TEMPLATE, coach_id: COACH_C, is_template: true, client_id: null, name: 'Shared template day', description: null, goal: null, archived: false },
      { id: COPY, coach_id: COACH_A, is_template: false, client_id: MOVED, name: 'Moved private day', description: 'Private notes', goal: null, archived: false },
      { id: A_OTHER_COPY, coach_id: COACH_A, is_template: false, client_id: A_OTHER, name: 'Other client day', description: null, goal: null, archived: false },
    ],
    workout_exercises: [
      { id: id('50000000', 1), workout_id: TEMPLATE, custom_name: 'Template goblet squat', sets: '3', reps: '8', rest: '60s', client_notes: null, position: 0, exercise_library_id: null, archived: false },
      { id: id('50000000', 2), workout_id: COPY, custom_name: 'Private split squat', sets: '4', reps: '6', rest: '90s', client_notes: 'Private cue', position: 0, exercise_library_id: null, archived: false },
      { id: id('50000000', 3), workout_id: A_OTHER_COPY, custom_name: 'Other client row', sets: '3', reps: '10', rest: '60s', client_notes: null, position: 0, exercise_library_id: null, archived: false },
    ],
    exercise_library: [],
    programs: [
      { id: PROGRAM_TEMPLATE, coach_id: COACH_C, is_template: true, client_id: null, hidden: false, archived: false },
      { id: PROGRAM_COPY, coach_id: COACH_A, is_template: false, client_id: MOVED, hidden: false, archived: false },
    ],
    sessions: [
      session(S_HIST, COACH_A, MOVED, COPY),
      session(S_LEGACY, COACH_A, A_OTHER, COPY),
      session(S_A, COACH_A, A_OTHER, null),
      session(S_B, COACH_B, MOVED, null),
      session(S_C, COACH_C, C_CLIENT, null),
    ],
    session_series: [],
    session_notes: [],
    notifications: [],
    workout_logs: [],
  };
}

// ---- In-memory PostgREST-ish fake: projections, nested embeds, column filters ----
const FOREIGN_KEYS = {
  'sessions:clients': 'client_id',
  'sessions:coaches': 'coach_id',
  'sessions:workouts': 'workout_id',
  'sessions:session_series': 'series_id',
  'workouts:clients': 'client_id',
  'programs:clients': 'client_id',
  'workout_exercises:exercise_library': 'exercise_library_id',
};

function splitTopLevel(str) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of str) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(current.trim()); current = ''; } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseSelect(str) {
  return splitTopLevel(str || '*').map((part) => {
    const embed = part.match(/^(\w+):(\w+)(?:!(\w+))?\(([\s\S]*)\)$/);
    if (embed) return { embed: true, alias: embed[1], table: embed[2], hint: embed[3], children: parseSelect(embed[4]) };
    return { column: part };
  });
}

let db;
function project(table, row, nodes) {
  const out = {};
  for (const node of nodes) {
    if (node.column === '*') Object.assign(out, row);
    else if (node.column) out[node.column] = row[node.column];
    else {
      const fk = node.hint && node.hint !== 'inner' ? node.hint : FOREIGN_KEYS[`${table}:${node.table}`];
      assert.ok(fk, `fake has no relationship ${table} -> ${node.table}`);
      const target = (db.tables[node.table] || []).find((candidate) => candidate.id === row[fk]);
      out[node.alias] = target ? project(node.table, target, node.children) : null;
    }
  }
  return out;
}

class Query {
  constructor(table) { this.table = table; this.filters = []; this.nodes = parseSelect('*'); this.mode = 'select'; this.opts = {}; }
  select(str = '*', opts = {}) { this.nodes = parseSelect(str); this.opts = opts; return this; }
  update(patch) { this.mode = 'update'; this.patch = patch; return this; }
  insert(row) { this.mode = 'insert'; this.row = row; return this; }
  eq(k, v) { this.filters.push((r) => r[k] === v); return this; }
  in(k, vs) { this.filters.push((r) => vs.includes(r[k])); return this; }
  gte(k, v) { this.filters.push((r) => r[k] >= v); return this; }
  lte(k, v) { this.filters.push((r) => r[k] <= v); return this; }
  lt(k, v) { this.filters.push((r) => r[k] < v); return this; }
  is(k, v) { this.filters.push((r) => (r[k] ?? null) === v); return this; }
  or() { return this; }
  order() { return this; }
  limit() { return this; }
  run() {
    const rows = db.tables[this.table] || (db.tables[this.table] = []);
    if (this.mode === 'insert') {
      const stored = { id: id('90000000', rows.length + 1), archived: false, ...this.row };
      rows.push(stored);
      db.writes.push({ table: this.table, insert: stored });
      return { data: [project(this.table, stored, this.nodes)], error: null };
    }
    const matched = rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.mode === 'update') {
      for (const r of matched) Object.assign(r, this.patch);
      db.writes.push({ table: this.table, update: this.patch, ids: matched.map((r) => r.id) });
    }
    if (this.opts.head) return { data: null, count: matched.length, error: null };
    return { data: matched.map((r) => project(this.table, r, this.nodes)), error: null };
  }
  maybeSingle() { const { data } = this.run(); return Promise.resolve({ data: data[0] || null, error: null }); }
  single() { const { data } = this.run(); return Promise.resolve(data[0] ? { data: data[0], error: null } : { data: null, error: { message: 'no rows' } }); }
  then(resolve, reject) { return Promise.resolve(this.run()).then(resolve, reject); }
}

function rpc(name, args) {
  db.rpcCalls.push({ name, args });
  if (name === 'schedule_session') {
    if (args.p_session_id) {
      const row = db.tables.sessions.find((s) => s.id === args.p_session_id);
      Object.assign(row, { scheduled_at: args.p_scheduled_at, duration_minutes: args.p_duration_minutes });
      return Promise.resolve({ data: { outcome: 'scheduled', session: { id: row.id }, location_overlaps: 0 }, error: null });
    }
    const row = {
      id: id('80000000', db.tables.sessions.length + 1), coach_id: args.p_coach_id, client_id: args.p_client_id,
      workout_id: null, series_id: null, scheduled_at: args.p_scheduled_at, duration_minutes: args.p_duration_minutes,
      location: args.p_location, status: 'scheduled', archived: false,
    };
    db.tables.sessions.push(row);
    return Promise.resolve({ data: { outcome: 'scheduled', session: { id: row.id }, location_overlaps: 0 }, error: null });
  }
  if (name === 'schedule_session_series') {
    return Promise.resolve({ data: { outcome: 'created', replayed: false, series: { id: id('70000000', 1) }, receipt: { slots: [] } }, error: null });
  }
  return Promise.resolve({ data: null, error: null });
}

function cache(relative, exports) {
  const resolved = require.resolve(relative);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

const { canAccessClient } = require('../src/security/access');
let currentUser;
cache('../src/supabase', { supabaseAdmin: { from: (table) => new Query(table), rpc } });
cache('../src/middleware/auth', {
  requireAuth: (req, _res, next) => { req.user = currentUser; next(); },
  requireCoach: (req, res, next) => (['coach', 'admin'].includes(req.user?.role) ? next() : res.status(403).json({ error: 'Coach access required' })),
  requireClient: (req, res, next) => (req.user?.role === 'client' ? next() : res.status(403).json({ error: 'Client access required' })),
  canAccessClient,
});
const noop = () => Promise.resolve({});
cache('../src/services/email', {
  dispatchEmail: noop, formatDenver: () => 'soon',
  notifySessionScheduled: noop, notifySessionRescheduled: noop, notifySessionCancelled: noop,
  notifySessionCancelledByClient: noop, notifySessionCancelRequested: noop,
  notifySeriesScheduled: noop, notifySeriesCancelled: noop,
});
cache('../src/services/push', { dispatchPush: () => {}, sendToClient: noop, sendToCoaches: noop });

const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/sessions', require('../src/routes/sessions'));
const server = http.createServer(app);
let baseUrl;
test.before(async () => {
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/sessions`;
});
test.after(() => { server.close(); });

const users = {
  coachA: { role: 'coach', coach: { id: COACH_A } },
  coachB: { role: 'coach', coach: { id: COACH_B } },
  coachC: { role: 'coach', coach: { id: COACH_C } },
  admin: { role: 'admin', coach: { id: ADMIN } },
  moved: { role: 'client', client: { id: MOVED, coach_id: COACH_B } },
  aOther: { role: 'client', client: { id: A_OTHER, coach_id: COACH_A } },
};

function as(user) {
  db = { tables: seed(), rpcCalls: [], writes: [] };
  currentUser = users[user];
}
function switchTo(user) { currentUser = users[user]; }

async function call(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method, headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function assertNoSecrets(payload, label) {
  const json = JSON.stringify(payload);
  for (const secret of SECRETS) assert.equal(json.includes(secret), false, `${label} must not reveal "${secret}"`);
}
const sessionRow = (sessionId) => db.tables.sessions.find((s) => s.id === sessionId);
const scheduleCalls = () => db.rpcCalls.filter((c) => c.name === 'schedule_session');
const seriesCalls = () => db.rpcCalls.filter((c) => c.name === 'schedule_session_series');
const sessionWrites = () => db.writes.filter((w) => w.table === 'sessions');

const today = require('../src/utils/time').todayDateInTz();
const day = (offset) => require('../src/utils/time').shiftDate(today, offset);
let requestCounter = 0;
const seriesBody = (clientId, overrides = {}) => ({
  request_id: id('60000000', (requestCounter += 1)), client_id: clientId, duration_minutes: 60, location: 'Studio',
  rule: { start_date: day(14), time: '17:00', weekdays: [2, 4], interval_weeks: 1, end: { count: 1 } },
  slots: [{ key: 'g1', date: day(14), time: '17:00', workout_id: null }],
  program_id: null, assign_program: false, notify: false, ...overrides,
});
const withSlotWorkout = (clientId, workoutId) => seriesBody(clientId, {
  slots: [{ key: 'g1', date: day(14), time: '17:00', workout_id: workoutId }],
});

// ---------------------------------------------------------------------------

test('former coach cannot attach the reassigned client\'s private copy, by any route', async () => {
  as('coachA');
  let res = await call('POST', '/', { client_id: A_OTHER, scheduled_at: FUTURE, duration_minutes: 60, workout_id: COPY });
  assert.equal(res.status, 400, 'create on a client A still coaches');
  assert.equal(scheduleCalls().length, 0, 'nothing was scheduled');

  res = await call('PUT', `/${S_A}`, { duration_minutes: 60, workout_id: COPY });
  assert.equal(res.status, 400, 'update of an own session');
  assert.equal(sessionRow(S_A).workout_id, null);

  res = await call('POST', '/', { client_id: MOVED, scheduled_at: FUTURE, duration_minutes: 60, workout_id: COPY });
  assert.equal(res.status, 404, 'the moved client is no longer A\'s');

  res = await call('POST', '/series', withSlotWorkout(A_OTHER, COPY));
  assert.equal(res.status, 400, 'series slot');
  res = await call('POST', '/series', seriesBody(A_OTHER, { program_id: PROGRAM_COPY }));
  assert.equal(res.status, 404, 'series program reference');
  assert.equal(seriesCalls().length, 0);
  assert.equal(scheduleCalls().length, 0);
  assert.deepEqual(sessionWrites(), []);
});

test('former coach cannot read the private copy through sessions that already carry it', async () => {
  as('coachA');
  const list = await call('GET', '/');
  assert.equal(list.status, 200);
  const hist = list.body.find((s) => s.id === S_HIST);
  assert.ok(hist, 'the historical session itself stays listed (session ownership is unchanged)');
  assert.equal(hist.workout, null);
  assert.equal(list.body.find((s) => s.id === S_LEGACY).workout, null);
  assertNoSecrets(list.body, 'session list');

  for (const sessionId of [S_HIST, S_LEGACY]) {
    const detail = await call('GET', `/${sessionId}/coach-detail`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.workout, null, 'plan is withheld');
    assertNoSecrets(detail.body, 'coach detail');
  }

  // The editor resends the stored workout_id; rescheduling keeps the client's
  // attachment untouched without revealing it, and cannot newly attach it.
  const moved = await call('PUT', `/${S_HIST}`, { duration_minutes: 45, workout_id: COPY });
  assert.equal(moved.status, 200);
  assert.equal(sessionRow(S_HIST).duration_minutes, 45);
  assert.equal(sessionRow(S_HIST).workout_id, COPY, 'stored attachment is not altered');
  assert.equal(moved.body.workout, null);
  assertNoSecrets(moved.body, 'update response');
});

test('current coach can attach, read and change the reassigned client\'s private copy', async () => {
  as('coachB');
  const created = await call('POST', '/', { client_id: MOVED, scheduled_at: FUTURE, duration_minutes: 60, workout_id: COPY });
  assert.equal(created.status, 201);
  assert.equal(created.body.workout.name, 'Moved private day');
  assert.equal(created.body.workout.client_owner, undefined, 'ownership columns are not echoed');

  const detail = await call('GET', `/${created.body.id}/coach-detail`);
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body.workout.exercises.map((e) => e.name), ['Private split squat']);

  const updated = await call('PUT', `/${S_B}`, { duration_minutes: 60, workout_id: COPY });
  assert.equal(updated.status, 200);
  assert.equal(sessionRow(S_B).workout_id, COPY);
  assert.equal((await call('GET', '/')).body.find((s) => s.id === S_B).workout.name, 'Moved private day');

  assert.equal((await call('POST', '/series', withSlotWorkout(MOVED, COPY))).status, 201);
  assert.equal((await call('POST', '/series', seriesBody(MOVED, { program_id: PROGRAM_COPY }))).status, 201);

  // Not widened: the historical session still belongs to the coach who ran it.
  assert.equal((await call('GET', `/${S_HIST}/coach-detail`)).status, 404);
  assert.equal((await call('PUT', `/${S_HIST}`, { duration_minutes: 30 })).status, 404);

  // A coach keeps using a non-reassigned client's own copy on that client's sessions.
  switchTo('coachA');
  assert.equal((await call('PUT', `/${S_A}`, { duration_minutes: 60, workout_id: A_OTHER_COPY })).status, 200);
  assert.equal((await call('GET', `/${S_A}/coach-detail`)).body.workout.name, 'Other client day');
});

test('a private copy only ever attaches to its own client\'s sessions', async () => {
  as('coachB');
  // B coaches Moved but must not paste Moved's plan onto someone else's session.
  db.tables.clients.push({ id: id('10000000', 9), coach_id: COACH_B, name: 'Second client of B', archived: false });
  const res = await call('POST', '/', { client_id: id('10000000', 9), scheduled_at: FUTURE, duration_minutes: 60, workout_id: COPY });
  assert.equal(res.status, 400);
  assert.equal(scheduleCalls().length, 0);
});

test('unrelated coaches are denied every path to the copy', async () => {
  as('coachC');
  assert.equal((await call('POST', '/', { client_id: C_CLIENT, scheduled_at: FUTURE, duration_minutes: 60, workout_id: COPY })).status, 400);
  assert.equal((await call('PUT', `/${S_C}`, { duration_minutes: 60, workout_id: COPY })).status, 400);
  assert.equal((await call('POST', '/series', withSlotWorkout(C_CLIENT, COPY))).status, 400);
  assert.equal((await call('POST', '/series', seriesBody(C_CLIENT, { program_id: PROGRAM_COPY }))).status, 404);
  for (const sessionId of [S_HIST, S_LEGACY, S_B]) {
    assert.equal((await call('GET', `/${sessionId}/coach-detail`)).status, 404);
  }
  assertNoSecrets((await call('GET', '/')).body, 'unrelated coach list');
  assert.equal(sessionRow(S_C).workout_id, null);
  assert.equal(scheduleCalls().length + seriesCalls().length, 0);
});

test('admin keeps full read access and attaches copies to their own client only', async () => {
  as('admin');
  const detail = await call('GET', `/${S_HIST}/coach-detail`);
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.body.workout.exercises.map((e) => e.name), ['Private split squat']);
  const list = await call('GET', '/');
  assert.equal(list.body.find((s) => s.id === S_HIST).workout.name, 'Moved private day');
  assert.equal((await call('POST', '/', { client_id: MOVED, scheduled_at: FUTURE, duration_minutes: 60, workout_id: COPY })).status, 201);
  assert.equal((await call('POST', '/', { client_id: A_OTHER, scheduled_at: FUTURE, duration_minutes: 60, workout_id: COPY })).status, 400);
});

test('clients see their own copy on their sessions, never another client\'s', async () => {
  as('moved');
  const own = await call('GET', `/${S_HIST}/client-detail`);
  assert.equal(own.status, 200);
  assert.deepEqual(own.body.workout.exercises.map((e) => e.name), ['Private split squat']);
  assert.equal(own.body.workout.client_owner, undefined, 'ownership columns are not echoed to clients');
  assert.equal((await call('GET', '/client/mine')).body.find((s) => s.id === S_HIST).workout.name, 'Moved private day');

  switchTo('aOther');
  const leaked = await call('GET', `/${S_LEGACY}/client-detail`);
  assert.equal(leaked.status, 200);
  assert.equal(leaked.body.workout, null);
  assertNoSecrets(leaked.body, 'another client\'s detail');
  const mine = await call('GET', '/client/mine');
  assert.equal(mine.body.find((s) => s.id === S_LEGACY).workout, null);
  assertNoSecrets(mine.body, 'another client\'s session list');
  assert.equal((await call('GET', `/${S_HIST}/client-detail`)).status, 404, 'still cannot open Moved\'s session');
});

test('shared templates still attach and display for every coach and client', async () => {
  as('coachA');
  assert.equal((await call('PUT', `/${S_A}`, { duration_minutes: 60, workout_id: TEMPLATE })).status, 200);
  assert.deepEqual((await call('GET', `/${S_A}/coach-detail`)).body.workout.exercises.map((e) => e.name), ['Template goblet squat']);
  assert.equal((await call('POST', '/series', withSlotWorkout(A_OTHER, TEMPLATE))).status, 201);
  assert.equal((await call('POST', '/series', seriesBody(A_OTHER, { program_id: PROGRAM_TEMPLATE }))).status, 201);
  switchTo('aOther');
  assert.equal((await call('GET', `/${S_A}/client-detail`)).body.workout.name, 'Shared template day');
  switchTo('coachC');
  const created = await call('POST', '/', { client_id: C_CLIENT, scheduled_at: FUTURE, duration_minutes: 60, workout_id: TEMPLATE });
  assert.equal(created.status, 201);
  assert.equal(created.body.workout.name, 'Shared template day');
});
