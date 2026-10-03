const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// ---- In-memory Supabase fake (just enough surface for the programs router) ----
const EMBEDS = {
  client: ['clients', 'client_id'],
  client_owner: ['clients', 'client_id'],
  program: ['programs', 'program_id'],
  workout: ['workouts', 'workout_id'],
  library_exercise: ['exercise_library', 'exercise_library_id'],
};

function makeDb(seed) {
  const db = { tables: JSON.parse(JSON.stringify(seed)), rpcCalls: [], updates: [], rpcResults: {} };

  function embed(row, selectStr) {
    const out = { ...row };
    for (const match of String(selectStr || '').matchAll(/(\w+):(\w+)(?:!\w+)?\(/g)) {
      const [, alias] = match;
      const spec = EMBEDS[alias];
      if (!spec) continue;
      const [table, fk] = spec;
      out[alias] = (db.tables[table] || []).find((r) => r.id === row[fk]) || null;
    }
    // program_assignments -> assignments:program_assignments(...) is not used by the routes under test
    return out;
  }

  class Query {
    constructor(table) {
      this.table = table; this.filters = []; this.selectStr = '*'; this.opts = {}; this.mode = 'select';
      this.patch = null; this.limitN = null;
    }
    select(str = '*', opts = {}) { this.selectStr = str; this.opts = opts; return this; }
    update(patch) { this.mode = 'update'; this.patch = patch; return this; }
    insert() { this.mode = 'insert'; return this; }
    eq(k, v) { this.filters.push((r) => get(r, k) === v); return this; }
    in(k, vs) { this.filters.push((r) => vs.includes(get(r, k))); return this; }
    not(k, op, v) { this.filters.push((r) => !(op === 'is' && v === null ? get(r, k) === null : false)); return this; }
    or() { return this; }
    order() { return this; }
    ilike() { return this; }
    limit(n) { this.limitN = n; return this; }
    rows() {
      let rows = (db.tables[this.table] || []).map((r) => embed(r, this.selectStr));
      rows = rows.filter((r) => this.filters.every((f) => f(r)));
      if (this.limitN) rows = rows.slice(0, this.limitN);
      return rows;
    }
    run() {
      if (this.mode === 'update') {
        const rows = this.rows();
        for (const r of rows) {
          const stored = db.tables[this.table].find((x) => x.id === r.id);
          Object.assign(stored, this.patch);
          db.updates.push({ table: this.table, id: r.id, patch: this.patch });
        }
        return { data: rows.map((r) => ({ ...r, ...this.patch })), error: null };
      }
      const rows = this.rows();
      if (this.opts.head) return { data: null, count: rows.length, error: null };
      return { data: rows, error: null };
    }
    maybeSingle() { const { data } = this.run(); return Promise.resolve({ data: data[0] || null, error: null }); }
    single() { const { data } = this.run(); return Promise.resolve({ data: data[0] || null, error: data[0] ? null : { message: 'no rows' } }); }
    then(resolve, reject) { return Promise.resolve(this.run()).then(resolve, reject); }
  }
  function get(row, key) {
    return key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), row);
  }

  db.client = {
    from: (table) => new Query(table),
    async rpc(name, args) {
      db.rpcCalls.push({ name, args });
      if (name in db.rpcResults) {
        const result = db.rpcResults[name];
        return typeof result === 'function' ? result(args) : result;
      }
      return { data: null, error: null };
    },
  };
  return db;
}

// ---- Fixtures ----
const A = 'aaaaaaaa-0000-0000-0000-00000000000a'; // coach A
const B = 'bbbbbbbb-0000-0000-0000-00000000000b'; // coach B
const ADMIN = 'cccccccc-0000-0000-0000-00000000000c';
const CLI_A = 'a1a1a1a1-0000-0000-0000-000000000001'; // client of coach A
const CLI_B = 'b1b1b1b1-0000-0000-0000-000000000002'; // client of coach B
const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

function seed() {
  return {
    coaches: [{ id: A, name: 'Coach A' }, { id: B, name: 'Coach B' }, { id: ADMIN, name: 'Admin' }],
    clients: [
      { id: CLI_A, coach_id: A, name: 'Client of A', archived: false },
      { id: CLI_B, coach_id: B, name: 'Client of B', archived: false },
    ],
    exercise_library: [
      { id: uuid(901), name: 'Squat', archived: false, hidden: false },
      { id: uuid(902), name: 'Secret Move', archived: false, hidden: true },
    ],
    workouts: [
      { id: uuid(1), coach_id: A, created_by: A, name: 'A template', is_template: true, hidden: false, archived: false },
      { id: uuid(2), coach_id: B, created_by: B, name: 'B template', is_template: true, hidden: false, archived: false },
      { id: uuid(3), coach_id: A, created_by: null, client_id: CLI_A, source_workout_id: uuid(1), name: 'A client copy', is_template: false, hidden: false, archived: false },
      { id: uuid(4), coach_id: A, created_by: A, name: 'Hidden template', is_template: true, hidden: true, archived: false },
      { id: uuid(5), coach_id: A, created_by: A, name: 'Legacy-linked', is_template: true, hidden: false, archived: false },
      { id: uuid(6), coach_id: A, created_by: A, name: 'Variation of A', is_template: true, hidden: false, variation_of: uuid(1), archived: false },
    ],
    workout_exercises: [
      { id: uuid(101), workout_id: uuid(1), exercise_library_id: uuid(901), custom_name: null, sets: '3', reps: '5', coach_notes: 'COACH ONLY', client_notes: 'cue', position: 0, archived: false },
      { id: uuid(103), workout_id: uuid(3), exercise_library_id: uuid(901), custom_name: null, sets: '3', reps: '5', coach_notes: 'COACH ONLY', client_notes: 'cue', position: 0, archived: false },
    ],
    programs: [
      { id: uuid(11), coach_id: A, created_by: A, name: 'A program', frequency_days: 1, is_template: true, hidden: false, archived: false },
      { id: uuid(12), coach_id: B, created_by: B, name: 'B program', frequency_days: 1, is_template: true, hidden: false, archived: false },
      { id: uuid(13), coach_id: A, created_by: null, client_id: CLI_A, source_program_id: uuid(11), name: 'A client program copy', frequency_days: 1, is_template: false, hidden: false, archived: false },
      { id: uuid(14), coach_id: A, created_by: A, name: 'Hidden program', frequency_days: 1, is_template: true, hidden: true, archived: false },
      { id: uuid(15), coach_id: A, created_by: A, name: 'Legacy program', frequency_days: 1, is_template: true, hidden: false, archived: false },
    ],
    program_days: [
      { id: uuid(21), program_id: uuid(11), day_number: 1, workout_id: uuid(1), archived: false },
      { id: uuid(23), program_id: uuid(13), day_number: 1, workout_id: uuid(3), archived: false },
      { id: uuid(25), program_id: uuid(15), day_number: 1, workout_id: uuid(5), archived: false },
    ],
    program_assignments: [
      // new-model: client A's copy
      { id: uuid(31), program_id: uuid(13), client_id: CLI_A, notes: null, archived: false },
      // legacy: live-linked to a shared template, one per coach's client
      { id: uuid(32), program_id: uuid(15), client_id: CLI_A, notes: null, archived: false },
      { id: uuid(33), program_id: uuid(15), client_id: CLI_B, notes: null, archived: false },
    ],
    workout_assignments: [],
    program_assignment_exercise_loads: [],
    workout_assignment_exercise_loads: [],
  };
}

let db;
let currentUser;
const users = {
  coachA: { authUserId: 'a', role: 'coach', coach: { id: A } },
  coachB: { authUserId: 'b', role: 'coach', coach: { id: B } },
  admin: { authUserId: 'x', role: 'admin', coach: { id: ADMIN } },
  clientA: { authUserId: 'ca', role: 'client', client: { id: CLI_A } },
};

async function withServer(t, fn) {
  const paths = ['../src/supabase', '../src/middleware/auth', '../src/routes/programs'].map((p) => require.resolve(p));
  const saved = paths.map((p) => require.cache[p]);
  const realAccess = require('../src/security/access');
  const requireAuth = (req, res, next) => { req.user = currentUser; next(); };
  const requireCoach = (req, res, next) => (['coach', 'admin'].includes(req.user?.role) ? next() : res.status(403).json({ error: 'Coach access required' }));
  const requireClient = (req, res, next) => (req.user?.role === 'client' ? next() : res.status(403).json({ error: 'Client access required' }));
  // Resolve the current db on every call: each test's setup() swaps in a fresh one.
  const supabaseAdmin = { from: (table) => db.client.from(table), rpc: (name, args) => db.client.rpc(name, args) };
  require.cache[paths[0]] = { id: paths[0], filename: paths[0], loaded: true, exports: { supabaseAdmin } };
  require.cache[paths[1]] = {
    id: paths[1], filename: paths[1], loaded: true,
    exports: { requireAuth, requireCoach, requireClient, canAccessClient: realAccess.canAccessClient },
  };
  delete require.cache[paths[2]];
  const router = require('../src/routes/programs');
  const app = express();
  app.use(express.json());
  app.use('/api/programs', router);
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  t.after(() => {
    server.close();
    paths.forEach((p, i) => { if (saved[i]) require.cache[p] = saved[i]; else delete require.cache[p]; });
  });
  const base = `http://127.0.0.1:${server.address().port}/api/programs`;
  const call = async (method, path, body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: response.status, body: json };
  };
  return fn(call);
}

function setup(user) {
  db = makeDb(seed());
  currentUser = users[user];
}

// ---------------------------------------------------------------------------

test('templates are readable by every coach; another coach\'s client copy is masked', async (t) => {
  await withServer(t, async (call) => {
    setup('coachB');
    assert.equal((await call('GET', `/workouts/${uuid(1)}`)).status, 200, 'B reads A\'s template workout');
    assert.equal((await call('GET', `/${uuid(11)}`)).status, 200, 'B reads A\'s template program');
    assert.equal((await call('GET', `/workouts/${uuid(3)}`)).status, 404, 'B cannot read A\'s client copy');
    assert.equal((await call('GET', `/${uuid(13)}`)).status, 404, 'B cannot read A\'s client program copy');
    const list = await call('GET', '/workouts');
    assert.equal(list.status, 200);
    const names = list.body.map((w) => w.name);
    assert.ok(names.includes('A template') && names.includes('B template'));
    assert.ok(!names.includes('A client copy'), 'client copies never appear in the template list');
    const programs = await call('GET', '/');
    assert.ok(!programs.body.some((p) => p.name === 'A client program copy'));
    assert.equal(programs.body.find((p) => p.id === uuid(11)).author.name, 'Coach A', 'publisher is shown to coaches');
  });
});

test('assignable=true excludes hidden templates and author filter narrows the list', async (t) => {
  await withServer(t, async (call) => {
    setup('coachB');
    const all = (await call('GET', '/workouts')).body.map((w) => w.name);
    assert.ok(all.includes('Hidden template'));
    const assignable = (await call('GET', '/workouts?assignable=true')).body.map((w) => w.name);
    assert.ok(!assignable.includes('Hidden template'));
    const mine = (await call('GET', '/workouts?author=me')).body.map((w) => w.name);
    assert.deepEqual(mine.sort(), ['B template']);
    const byA = (await call('GET', `/workouts?author=${A}`)).body.map((w) => w.name);
    assert.ok(byA.includes('A template') && byA.includes('Variation of A') && !byA.includes('B template'));
  });
});

test('assigning clones via RPC, for the caller\'s own clients only, never hidden or instance rows', async (t) => {
  await withServer(t, async (call) => {
    setup('coachB');
    // The fake RPC does what the real one does: creates B's private copy plus its assignment.
    db.rpcResults.assign_program_clone = (args) => {
      db.tables.programs.push({ id: uuid(70), coach_id: B, client_id: args.p_client_id, source_program_id: args.p_program_id, name: 'copy for B client', frequency_days: 1, is_template: false, hidden: false, archived: false });
      db.tables.program_assignments.push({ id: uuid(77), program_id: uuid(70), client_id: args.p_client_id, notes: null, archived: false });
      return { data: uuid(77), error: null };
    };
    // B assigns A's shared template to B's own client
    let res = await call('POST', `/${uuid(11)}/assign`, { client_id: CLI_B, notes: 'n', exercise_loads: [{ program_day_id: uuid(21), workout_exercise_id: uuid(101), load_value: 100, load_unit: 'lb' }] });
    assert.equal(res.status, 201);
    const rpc = db.rpcCalls.find((c) => c.name === 'assign_program_clone');
    assert.equal(rpc.args.p_program_id, uuid(11));
    assert.equal(rpc.args.p_client_id, CLI_B);
    assert.equal(rpc.args.p_loads[0].workout_exercise_id, uuid(101), 'loads are keyed by template ids; the RPC remaps them');
    assert.ok(!db.rpcCalls.some((c) => c.name === 'save_program_assignment_with_loads'), 'no live link to the template');
    assert.equal(res.body.program.id, uuid(70), 'the response carries the client\'s private copy, not the template');
    assert.equal(db.tables.programs.find((p) => p.id === uuid(11)).name, 'A program', 'template untouched');
    // Assigning the same template to the same client again is refused (it is already a copy of it)
    db.rpcCalls.length = 0;
    res = await call('POST', `/${uuid(11)}/assign`, { client_id: CLI_B });
    assert.equal(res.status, 409);
    assert.match(res.body.error, /already assigned/);
    assert.equal(db.rpcCalls.length, 0);
    // B cannot assign to A's client
    db.rpcCalls.length = 0;
    res = await call('POST', `/${uuid(11)}/assign`, { client_id: CLI_A });
    assert.equal(res.status, 404);
    // hidden template is refused
    res = await call('POST', `/${uuid(14)}/assign`, { client_id: CLI_B });
    assert.equal(res.status, 409);
    // a client's own copy is not an assignable template
    res = await call('POST', `/${uuid(13)}/assign`, { client_id: CLI_B });
    assert.equal(res.status, 404);
    assert.equal(db.rpcCalls.length, 0, 'none of the refused requests reached the database');
  });
});

test('assigning a workout uses the clone RPC and refuses hidden templates', async (t) => {
  await withServer(t, async (call) => {
    setup('coachA');
    db.rpcResults.assign_workout_clone = { data: uuid(88), error: null };
    db.tables.workout_assignments.push({ id: uuid(88), client_id: CLI_A, workout_id: uuid(3), assignment_mode: 'active', archived: false });
    let res = await call('POST', '/workout-assignments', { client_id: CLI_A, workout_id: uuid(2), assignment_mode: 'active' });
    assert.equal(res.status, 201, 'A assigns B\'s shared template workout to A\'s client');
    assert.equal(db.rpcCalls[0].name, 'assign_workout_clone');
    assert.equal(db.rpcCalls[0].args.p_workout_id, uuid(2));
    res = await call('POST', '/workout-assignments', { client_id: CLI_A, workout_id: uuid(4) });
    assert.equal(res.status, 409, 'hidden');
    res = await call('POST', '/workout-assignments', { client_id: CLI_A, workout_id: uuid(3) });
    assert.equal(res.status, 404, 'a client copy cannot be re-assigned');
  });
});

test('RPC "not found" and bad-load errors map to 404/400 instead of 500', async (t) => {
  await withServer(t, async (call) => {
    setup('coachB');
    db.rpcResults.assign_program_clone = { data: null, error: { message: 'Invalid program assignment exercise load' } };
    let res = await call('POST', `/${uuid(11)}/assign`, { client_id: CLI_B });
    assert.equal(res.status, 400);
    db.rpcResults.assign_program_clone = { data: null, error: { message: 'Program not found' } };
    res = await call('POST', `/${uuid(11)}/assign`, { client_id: CLI_B });
    assert.equal(res.status, 404);
  });
});

test('assignment loads/archive authorize by the client\'s coach, not the program author', async (t) => {
  await withServer(t, async (call) => {
    // Assignment 31 is client A's copy. Coach B (not A's coach) is refused; coach A and admin succeed.
    setup('coachB');
    assert.equal((await call('PUT', `/assignments/${uuid(31)}/loads`, { exercise_loads: [] })).status, 404);
    assert.equal((await call('PATCH', `/assignments/${uuid(31)}/archive`)).status, 404);
    setup('coachA');
    assert.equal((await call('PATCH', `/assignments/${uuid(32)}/archive`)).status, 200, 'A may unassign own client from a template-linked legacy assignment authored by A');
    // legacy assignment 33 belongs to B's client on A's program: A must NOT be able to remove it
    assert.equal((await call('PATCH', `/assignments/${uuid(33)}/archive`)).status, 404);
    setup('coachB');
    assert.equal((await call('PATCH', `/assignments/${uuid(33)}/archive`)).status, 200, 'B may unassign own client although A authored the program');
    setup('admin');
    assert.equal((await call('PATCH', `/assignments/${uuid(31)}/archive`)).status, 200);
  });
});

test('client copy assignments are listed for the client\'s coach only', async (t) => {
  await withServer(t, async (call) => {
    setup('coachA');
    const res = await call('GET', `/program-assignments/client/${CLI_A}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.some((a) => a.program.id === uuid(13)), 'the client\'s own copy is returned');
    setup('coachB');
    assert.equal((await call('GET', `/program-assignments/client/${CLI_A}`)).status, 404);
  });
});

test('legacy 409 guard: templates with live-linked assignments cannot be edited or archived', async (t) => {
  await withServer(t, async (call) => {
    setup('coachB'); // any coach hits the guard, not just the author
    // program 15 has two active legacy assignments
    let res = await call('PUT', `/${uuid(15)}`, { name: 'renamed' });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'LEGACY_ASSIGNMENTS');
    assert.equal(res.body.assignment_count, 2);
    assert.match(res.body.error, /Save it as a variation/);
    res = await call('PATCH', `/${uuid(15)}/archive`);
    assert.equal(res.status, 409);
    // workout 5 is used by program 15 (which has legacy assignments)
    res = await call('PUT', `/workouts/${uuid(5)}`, { name: 'renamed' });
    assert.equal(res.status, 409);
    res = await call('PATCH', `/workouts/${uuid(5)}/archive`);
    assert.equal(res.status, 409);
    assert.ok(!db.rpcCalls.some((c) => ['save_workout', 'save_program'].includes(c.name)), 'nothing was written');
    assert.ok(!db.updates.some((u) => u.table === 'programs' || u.table === 'workouts'));
  });
});

test('the legacy guard does not block templates without live links, or client copies', async (t) => {
  await withServer(t, async (call) => {
    setup('coachB');
    db.rpcResults.save_workout = { data: uuid(2), error: null };
    let res = await call('PUT', `/workouts/${uuid(2)}`, { name: 'B template renamed' });
    assert.equal(res.status, 200, 'unassigned template edits freely');
    assert.equal(db.rpcCalls.find((c) => c.name === 'save_workout').args.p_workout_id, uuid(2));
    // Archive of an unlinked template works
    res = await call('PATCH', `/workouts/${uuid(2)}/archive`);
    assert.equal(res.status, 200);
    // A client copy (is_template false) is never guarded, even though it has assignments
    setup('coachA');
    db.tables.workout_assignments.push({ id: uuid(60), client_id: CLI_A, workout_id: uuid(3), archived: false });
    db.rpcResults.save_workout = { data: uuid(3), error: null };
    res = await call('PUT', `/workouts/${uuid(3)}`, { name: 'tuned for this client' });
    assert.equal(res.status, 200);
    // ...but another coach cannot touch it
    setup('coachB');
    assert.equal((await call('PUT', `/workouts/${uuid(3)}`, { name: 'x' })).status, 404);
  });
});

test('hidden library exercises cannot be newly added to a workout', async (t) => {
  await withServer(t, async (call) => {
    setup('coachB');
    db.rpcResults.save_workout = { data: uuid(2), error: null };
    let res = await call('POST', '/workouts', { name: 'New', exercises: [{ exercise_library_id: uuid(902) }] });
    assert.equal(res.status, 422);
    assert.match(res.body.error, /Secret Move/);
    res = await call('POST', '/workouts', { name: 'New', exercises: [{ exercise_library_id: uuid(901) }] });
    assert.equal(res.status, 201);
    assert.equal(db.rpcCalls.find((c) => c.name === 'save_workout').args.p_coach_id, B, 'creator is recorded as author, admin or not');
  });
});

test('hide/unhide is template-only and boolean-only', async (t) => {
  await withServer(t, async (call) => {
    setup('coachB');
    assert.equal((await call('PATCH', `/workouts/${uuid(2)}/hidden`, { hidden: 'yes' })).status, 400);
    assert.equal((await call('PATCH', `/workouts/${uuid(2)}/hidden`, { hidden: true })).status, 200);
    assert.equal(db.tables.workouts.find((w) => w.id === uuid(2)).hidden, true);
    assert.equal((await call('PATCH', `/workouts/${uuid(3)}/hidden`, { hidden: true })).status, 404, 'client copies have no hidden flag to toggle (and are not B\'s)');
    assert.equal((await call('PATCH', `/${uuid(12)}/hidden`, { hidden: true })).status, 200);
  });
});

test('save-as-template defaults the variation parent to the source template and copies as the caller', async (t) => {
  await withServer(t, async (call) => {
    setup('coachA');
    db.rpcResults.save_workout_as_template = { data: uuid(6), error: null };
    // From A's client copy (source template uuid(1))
    let res = await call('POST', `/workouts/${uuid(3)}/save-as-template`, { name: 'Knee friendly' });
    assert.equal(res.status, 201);
    let rpc = db.rpcCalls.find((c) => c.name === 'save_workout_as_template');
    assert.equal(rpc.args.p_workout_id, uuid(3));
    assert.equal(rpc.args.p_coach_id, A);
    assert.equal(rpc.args.p_variation_of, uuid(1));
    assert.equal(rpc.args.p_name, 'Knee friendly');
    // Explicit null = standalone
    db.rpcCalls.length = 0;
    await call('POST', `/workouts/${uuid(3)}/save-as-template`, { variation_of: null });
    assert.equal(db.rpcCalls[0].args.p_variation_of, null);
    // Duplicating a template defaults to a variation of itself, named so it reads apart
    db.rpcCalls.length = 0;
    await call('POST', `/workouts/${uuid(1)}/save-as-template`, {});
    assert.equal(db.rpcCalls[0].args.p_variation_of, uuid(1));
    assert.equal(db.rpcCalls[0].args.p_name, 'A template (variation)');
    // A standalone copy (explicit null parent, no name) keeps the source name
    db.rpcCalls.length = 0;
    await call('POST', `/workouts/${uuid(1)}/save-as-template`, { variation_of: null });
    assert.equal(db.rpcCalls[0].args.p_name, null);
    db.rpcResults.save_program_as_template = { data: uuid(15), error: null };
    db.rpcCalls.length = 0;
    await call('POST', `/${uuid(11)}/save-as-template`, {});
    assert.equal(db.rpcCalls[0].args.p_name, 'A program (variation)');
    // A stale default parent (archived template) falls back to standalone rather than failing
    db.tables.workouts.find((w) => w.id === uuid(1)).archived = true;
    db.rpcCalls.length = 0;
    await call('POST', `/workouts/${uuid(3)}/save-as-template`, {});
    assert.equal(db.rpcCalls[0].args.p_variation_of, null);
    // An explicit bad parent is a 400
    res = await call('POST', `/workouts/${uuid(3)}/save-as-template`, { variation_of: 'nope' });
    assert.equal(res.status, 400);
    res = await call('POST', `/workouts/${uuid(3)}/save-as-template`, { variation_of: uuid(3) });
    assert.equal(res.status, 400, 'a client copy is not a valid variation parent');
    // Another coach cannot copy A's client copy
    setup('coachB');
    res = await call('POST', `/workouts/${uuid(3)}/save-as-template`, {});
    assert.equal(res.status, 404);
  });
});

test('shared program detail only reveals legacy assignments for the caller\'s own clients', async (t) => {
  await withServer(t, async (call) => {
    setup('coachB');
    const res = await call('GET', `/${uuid(15)}`);
    assert.equal(res.status, 200);
    const clients = res.body.assignments.map((a) => a.client.name);
    assert.deepEqual(clients, ['Client of B'], 'coach A\'s client is not exposed to coach B');
    setup('admin');
    assert.equal((await call('GET', `/${uuid(15)}`)).body.assignments.length, 2);
    const list = await call('GET', '/');
    const legacy = list.body.find((p) => p.id === uuid(15));
    assert.equal(legacy.active_assignments.length, 2);
    setup('coachA');
    const listA = await call('GET', '/');
    assert.deepEqual(listA.body.find((p) => p.id === uuid(15)).active_assignments.map((a) => a.client.name), ['Client of A']);
  });
});

test('client assigned view exposes no attribution, provenance, coach notes, or other clients', async (t) => {
  await withServer(t, async (call) => {
    setup('clientA');
    db.tables.program_assignments = db.tables.program_assignments.filter((a) => a.id === uuid(31) || a.id === uuid(32) || a.id === uuid(33));
    const res = await call('GET', '/client/assigned');
    assert.equal(res.status, 200);
    const json = JSON.stringify(res.body);
    for (const secret of ['COACH ONLY', 'Client of B', 'created_by', 'source_program_id', 'source_workout_id', 'variation_of', '"hidden"', 'is_template', 'coach_notes', 'Coach A', 'Coach B']) {
      assert.equal(json.includes(secret), false, `client payload must not contain ${secret}`);
    }
    assert.ok(res.body.programs.length >= 1);
    const exercise = res.body.programs.flatMap((p) => p.program.days).flatMap((d) => d.workout.exercises)[0];
    assert.equal(exercise.client_notes, 'cue', 'client-facing cues still reach the client');
    assert.equal(exercise.sets, '3');
    // Coach-only routes stay closed to clients
    assert.equal((await call('GET', '/workouts')).status, 403);
  });
});

test('client copies follow an admin reassignment: the former coach is masked, the new coach takes over', async (t) => {
  await withServer(t, async (call) => {
    setup('coachA');
    // Admin reassigned client A to coach B; the copies still carry coach A from when they were cloned.
    db.tables.clients.find((c) => c.id === CLI_A).coach_id = B;
    assert.equal((await call('GET', `/workouts/${uuid(3)}`)).status, 404, 'former coach cannot read the workout copy');
    assert.equal((await call('GET', `/${uuid(13)}`)).status, 404, 'former coach cannot read the program copy');
    assert.equal((await call('GET', `/${uuid(13)}/export.pdf`)).status, 404, 'former coach cannot export the program copy');
    assert.equal((await call('PUT', `/workouts/${uuid(3)}`, { name: 'Changed' })).status, 404);
    assert.equal((await call('PUT', `/${uuid(13)}`, { name: 'Changed' })).status, 404);
    assert.equal((await call('PATCH', `/workouts/${uuid(3)}/archive`)).status, 404);
    assert.equal((await call('PATCH', `/${uuid(13)}/archive`)).status, 404);
    assert.equal((await call('POST', `/workouts/${uuid(3)}/save-as-template`, {})).status, 404);
    assert.equal((await call('POST', `/${uuid(13)}/save-as-template`, {})).status, 404);
    assert.deepEqual(db.rpcCalls, [], 'no write RPC ran for the former coach');
    assert.deepEqual(db.updates, [], 'no row changed for the former coach');

    currentUser = users.coachB;
    db.rpcResults.save_workout = { data: uuid(3), error: null };
    db.rpcResults.save_program = { data: uuid(13), error: null };
    assert.equal((await call('GET', `/workouts/${uuid(3)}`)).status, 200, 'new coach reads the workout copy');
    assert.equal((await call('GET', `/${uuid(13)}`)).status, 200, 'new coach reads the program copy');
    assert.equal((await call('PUT', `/workouts/${uuid(3)}`, { name: 'Changed' })).status, 200, 'new coach edits the workout copy');
    assert.equal((await call('PUT', `/${uuid(13)}`, { name: 'Changed' })).status, 200, 'new coach edits the program copy');
  });
});
