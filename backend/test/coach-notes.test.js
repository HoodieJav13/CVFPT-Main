// Coach Notes: private per-client notes for the coaches authorized for that
// client. These tests mount the real clients router behind the REAL auth
// middleware (requireAuth/requireCoach) and the real canAccessClient; only the
// Supabase client and outbound email services are in-memory fakes with
// fictional rows. Database grants are checked separately in
// supabase/tests/coach_notes (disposable PGlite) — this file is not database
// evidence.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const root = path.join(__dirname, '..', '..');
const migrationName = '20261022040000_client_coach_notes.sql';
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', migrationName), 'utf8');

const ID = {
  coachA: 'a0000000-0000-4000-8000-00000000000a',
  coachB: 'b0000000-0000-4000-8000-00000000000b',
  admin: 'c0000000-0000-4000-8000-00000000000c',
  retired: 'd0000000-0000-4000-8000-00000000000d',
  clientA: '1a000000-0000-4000-8000-0000000000a1',
  clientB: '1b000000-0000-4000-8000-0000000000b1',
  archivedClient: '1c000000-0000-4000-8000-0000000000c1',
  noteA1: 'aa000000-0000-4000-8000-0000000000a1',
  noteA2: 'aa000000-0000-4000-8000-0000000000a2',
  noteB1: 'bb000000-0000-4000-8000-0000000000b1',
  noteArchived: 'ac000000-0000-4000-8000-0000000000c1',
};

// Fictional auth users -> tokens. Profiles are resolved by the real middleware.
const TOKENS = {
  'tok-coach-a': 'auth-coach-a',
  'tok-coach-b': 'auth-coach-b',
  'tok-admin': 'auth-admin',
  'tok-retired-coach': 'auth-retired',
  'tok-client-a': 'auth-client-a',
  'tok-client-b': 'auth-client-b',
  'tok-unlinked': 'auth-unlinked',
};

function seed() {
  return {
    coaches: [
      { id: ID.coachA, auth_user_id: 'auth-coach-a', name: 'Fictional Coach A', is_admin: false, archived: false },
      { id: ID.coachB, auth_user_id: 'auth-coach-b', name: 'Fictional Coach B', is_admin: false, archived: false },
      { id: ID.admin, auth_user_id: 'auth-admin', name: 'Fictional Admin', is_admin: true, archived: false },
      { id: ID.retired, auth_user_id: 'auth-retired', name: 'Fictional Retired Coach', is_admin: false, archived: true },
    ],
    clients: [
      { id: ID.clientA, auth_user_id: 'auth-client-a', coach_id: ID.coachA, name: 'Sample Client A', archived: false, health_notes: 'client-visible' },
      { id: ID.clientB, auth_user_id: 'auth-client-b', coach_id: ID.coachB, name: 'Sample Client B', archived: false },
      { id: ID.archivedClient, auth_user_id: null, coach_id: ID.coachA, name: 'Archived Sample', archived: true },
    ],
    client_coach_notes: [
      { id: ID.noteA1, client_id: ID.clientA, author_coach_id: ID.coachA, author_name_snapshot: 'Fictional Coach A', content: 'Prefers morning sessions.', archived: false, created_at: '2026-10-20T15:00:00.000Z', updated_at: '2026-10-20T15:00:00.000Z' },
      { id: ID.noteA2, client_id: ID.clientA, author_coach_id: ID.admin, author_name_snapshot: 'Fictional Admin', content: 'Check knee comfort on lunges.', archived: false, created_at: '2026-10-21T16:00:00.000Z', updated_at: '2026-10-21T16:30:00.000Z' },
      { id: ID.noteB1, client_id: ID.clientB, author_coach_id: ID.coachB, author_name_snapshot: 'Fictional Coach B', content: 'PRIVATE-B: unrelated coach note.', archived: false, created_at: '2026-10-21T10:00:00.000Z', updated_at: '2026-10-21T10:00:00.000Z' },
      { id: ID.noteArchived, client_id: ID.clientA, author_coach_id: ID.coachA, author_name_snapshot: 'Fictional Coach A', content: 'Archived note.', archived: true, created_at: '2026-10-19T10:00:00.000Z', updated_at: '2026-10-19T10:00:00.000Z' },
    ],
  };
}

const state = { db: seed(), calls: [], raceNextUpdate: false };
const reset = () => { state.db = seed(); state.calls = []; state.raceNextUpdate = false; };
const noteCalls = () => state.calls.filter((call) => call.table === 'client_coach_notes');

class Query {
  constructor(table) { this.table = table; this.filters = []; this.fields = null; this.op = 'select'; this.payload = null; this.orders = []; this.max = null; }
  log(kind, detail) { state.calls.push({ table: this.table, kind, detail }); return this; }
  select(fields) { this.fields = fields; return this.log('select', fields); }
  eq(field, value) { this.filters.push([field, value]); return this.log('eq', [field, value]); }
  order(field, options) { this.orders.push([field, options?.ascending !== false]); return this; }
  limit(n) { this.max = n; return this; }
  insert(row) { this.op = 'insert'; this.payload = row; return this.log('insert', row); }
  update(patch) { this.op = 'update'; this.payload = patch; return this.log('update', patch); }
  project(row) {
    if (!this.fields || this.fields === '*') return { ...row };
    return Object.fromEntries(this.fields.split(',').map((f) => f.trim()).map((f) => [f, row[f]]));
  }
  matches() { return (state.db[this.table] || []).filter((row) => this.filters.every(([f, v]) => row[f] === v)); }
  run() {
    if (this.op === 'insert') {
      const now = new Date().toISOString();
      const row = { id: `ee000000-0000-4000-8000-${String(state.db[this.table].length + 1).padStart(12, '0')}`, archived: false, created_at: now, updated_at: now, ...this.payload };
      state.db[this.table].push(row);
      return [row];
    }
    if (this.op === 'update') {
      if (state.raceNextUpdate) {
        // Another save lands between this request's read and its conditional write.
        state.raceNextUpdate = false;
        this.matches().forEach((row) => { row.updated_at = '2026-10-22T09:09:09.000Z'; });
      }
      const rows = this.matches();
      rows.forEach((row) => Object.assign(row, this.payload));
      return rows;
    }
    let rows = this.matches();
    for (const [field, ascending] of [...this.orders].reverse()) {
      rows = [...rows].sort((a, b) => (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0) * (ascending ? 1 : -1));
    }
    return this.max == null ? rows : rows.slice(0, this.max);
  }
  async single() { const rows = this.run(); return rows.length === 1 ? { data: this.project(rows[0]), error: null } : { data: null, error: { message: 'not single' } }; }
  async maybeSingle() { const rows = this.run(); return { data: rows[0] ? this.project(rows[0]) : null, error: null }; }
  then(resolve, reject) { return Promise.resolve({ data: this.run().map((row) => this.project(row)), error: null }).then(resolve, reject); }
}

const supabaseAdmin = {
  from(table) { return new Query(table); },
  auth: {
    async getUser(token) {
      const id = TOKENS[token];
      return id ? { data: { user: { id, email: `${id}@example.invalid` } }, error: null } : { data: null, error: { message: 'invalid' } };
    },
  },
  async rpc() { throw new Error('no RPC is expected for coach notes'); },
};

function stub(modulePath, exports) {
  const id = require.resolve(modulePath);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
stub('../src/supabase', { supabaseAdmin });
stub('../src/services/email', { configured: () => false, FROM: 'Test <from@example.invalid>', dispatchEmail: () => { throw new Error('no email expected'); } });
stub('../src/services/accountRecovery', { sendPasswordResetEmail: () => { throw new Error('no email expected'); } });
// Real middleware and real access rules, loaded against the fake Supabase client.
const realAuth = require('../src/middleware/auth');
const router = require('../src/routes/clients');

async function withServer(fn) {
  const app = express();
  app.use(express.json());
  app.use('/api/clients', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try { await fn(`http://127.0.0.1:${server.address().port}/api/clients`); } finally { await new Promise((resolve) => server.close(resolve)); }
}

async function call(base, pathname, { token, method = 'GET', body } = {}) {
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) };
  const response = await fetch(base + pathname, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, data: await response.json() };
}

const notesPath = (clientId, noteId) => `/${clientId}/coach-notes${noteId ? `/${noteId}` : ''}`;
const ALLOWED_FIELDS = ['author_coach_id', 'author_name_snapshot', 'client_id', 'content', 'created_at', 'id', 'updated_at'];

test('migration: a separate service-role-only table, RLS on, no delete, no realtime/notification/client-row change', () => {
  assert.match(migration, /create table if not exists public\.client_coach_notes/);
  assert.match(migration, /client_id uuid not null references public\.clients\(id\)/);
  assert.match(migration, /author_coach_id uuid not null references public\.coaches\(id\)/);
  assert.match(migration, /author_name_snapshot text not null check \(btrim\(author_name_snapshot\) <> ''\)/);
  assert.match(migration, /content = btrim\(content\)\s+and char_length\(content\) between 1 and 4000/);
  assert.match(migration, /archived boolean not null default false/);
  assert.match(migration, /alter table public\.client_coach_notes enable row level security/);
  assert.match(migration, /revoke all privileges on table public\.client_coach_notes from public, anon, authenticated, service_role/);
  assert.match(migration, /grant select, insert, update on table public\.client_coach_notes to service_role/);
  assert.doesNotMatch(migration, /grant[^;]*(delete|anon|authenticated)/i);
  assert.doesNotMatch(migration, /create policy|publication|realtime|notification|trigger/i);
  assert.doesNotMatch(migration, /alter table public\.clients|update public\.clients/i);
  assert.equal(realAuth.canAccessClient.length, 2, 'the real access rule is in use');
});

test('only the coach-only clients router reads or writes coach notes', () => {
  const files = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full); else if (/\.(c?js|mjs)$/.test(entry.name)) files.push(full);
  });
  walk(path.join(__dirname, '..', 'src'));
  const users = files.filter((file) => /client_coach_notes|coach-notes/.test(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(users.map((file) => path.relative(path.join(__dirname, '..'), file)), [path.join('src', 'routes', 'clients.js')]);
  assert.match(fs.readFileSync(users[0], 'utf8'), /^router\.use\(requireAuth, requireCoach\);$/m);
});

test('the owning coach reads newest first, adds and edits own notes with server-set authorship', async () => withServer(async (base) => {
  reset();
  let r = await call(base, notesPath(ID.clientA), { token: 'tok-coach-a' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.notes.map((note) => note.id), [ID.noteA2, ID.noteA1], 'newest first; archived and other clients\' notes excluded');
  r.data.notes.forEach((note) => assert.deepEqual(Object.keys(note).sort(), ALLOWED_FIELDS));

  r = await call(base, notesPath(ID.clientA), { token: 'tok-coach-a', method: 'POST', body: { content: '  Ask about sleep.  ', author_coach_id: ID.admin, client_id: ID.clientB, author_name_snapshot: 'Forged' } });
  assert.equal(r.status, 201);
  assert.deepEqual({ content: r.data.content, client: r.data.client_id, author: r.data.author_coach_id, name: r.data.author_name_snapshot },
    { content: 'Ask about sleep.', client: ID.clientA, author: ID.coachA, name: 'Fictional Coach A' });
  assert.deepEqual(Object.keys(r.data).sort(), ALLOWED_FIELDS);
  const created = r.data;

  r = await call(base, notesPath(ID.clientA, created.id), { token: 'tok-coach-a', method: 'PUT', body: { content: 'Ask about sleep and stress.', expected_updated_at: created.updated_at, author_coach_id: ID.coachB } });
  assert.equal(r.status, 200);
  assert.equal(r.data.content, 'Ask about sleep and stress.');
  assert.equal(r.data.author_coach_id, ID.coachA);
  assert.equal(r.data.created_at, created.created_at);
  const write = state.calls.filter((c) => c.table === 'client_coach_notes' && c.kind === 'update').at(-1);
  assert.deepEqual(Object.keys(write.detail).sort(), ['content', 'updated_at'], 'an edit changes only the text and its time');
}));

test('a stale or concurrent edit is refused without overwriting the newer text', async () => withServer(async (base) => {
  reset();
  let r = await call(base, notesPath(ID.clientA, ID.noteA1), { token: 'tok-coach-a', method: 'PUT', body: { content: 'Old screen text', expected_updated_at: '2026-10-01T00:00:00.000Z' } });
  assert.equal(r.status, 409);
  assert.equal(r.data.note.content, 'Prefers morning sessions.');
  assert.equal(noteCalls().some((c) => c.kind === 'update'), false);
  state.raceNextUpdate = true;
  r = await call(base, notesPath(ID.clientA, ID.noteA1), { token: 'tok-coach-a', method: 'PUT', body: { content: 'Racing edit', expected_updated_at: '2026-10-20T15:00:00.000Z' } });
  assert.equal(r.status, 409);
  assert.equal(state.db.client_coach_notes.find((n) => n.id === ID.noteA1).content, 'Prefers morning sessions.');
}));

test('an admin (authorized for every client) reads and adds, but cannot edit another coach\'s note', async () => withServer(async (base) => {
  reset();
  let r = await call(base, notesPath(ID.clientA), { token: 'tok-admin' });
  assert.equal(r.status, 200);
  assert.equal(r.data.notes.length, 2);
  r = await call(base, notesPath(ID.clientB), { token: 'tok-admin', method: 'POST', body: { content: 'Admin check-in.' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.author_name_snapshot, 'Fictional Admin');
  const before = noteCalls().filter((c) => c.kind === 'update').length;
  r = await call(base, notesPath(ID.clientA, ID.noteA1), { token: 'tok-admin', method: 'PUT', body: { content: 'Admin rewrite', expected_updated_at: '2026-10-20T15:00:00.000Z' } });
  assert.equal(r.status, 403);
  assert.equal(noteCalls().filter((c) => c.kind === 'update').length, before);
  assert.equal(state.db.client_coach_notes.find((n) => n.id === ID.noteA1).content, 'Prefers morning sessions.');
}));

test('client sessions are refused before any notes query, for their own client too', async () => withServer(async (base) => {
  reset();
  for (const token of ['tok-client-a', 'tok-client-b']) {
    for (const [pathname, method, body] of [
      [notesPath(ID.clientA), 'GET'],
      [notesPath(ID.clientA), 'POST', { content: 'Client attempt' }],
      [notesPath(ID.clientA, ID.noteA1), 'PUT', { content: 'Client attempt', expected_updated_at: '2026-10-20T15:00:00.000Z' }],
    ]) {
      const r = await call(base, pathname, { token, method, body });
      assert.equal(r.status, 403, `${token} ${method}`);
      assert.deepEqual(r.data, { error: 'Coach access required' });
      assert.doesNotMatch(JSON.stringify(r.data), /morning|knee|PRIVATE/);
    }
  }
  assert.deepEqual(noteCalls(), []);
}));

test('an unrelated coach gets the same 404 as a missing client, before any notes query', async () => withServer(async (base) => {
  reset();
  for (const [pathname, method, body] of [
    [notesPath(ID.clientA), 'GET'],
    [notesPath(ID.clientA), 'POST', { content: 'Unrelated attempt' }],
    [notesPath(ID.clientA, ID.noteA1), 'PUT', { content: 'Unrelated attempt', expected_updated_at: '2026-10-20T15:00:00.000Z' }],
  ]) {
    const r = await call(base, pathname, { token: 'tok-coach-b', method, body });
    assert.equal(r.status, 404, method);
    assert.doesNotMatch(JSON.stringify(r.data), /morning|knee/);
  }
  assert.deepEqual(noteCalls(), []);
  assert.equal(state.db.client_coach_notes.length, 4);
}));

test('retired coach accounts, unlinked accounts and missing or invalid tokens are refused', async () => withServer(async (base) => {
  reset();
  assert.equal((await call(base, notesPath(ID.clientA), { token: 'tok-retired-coach' })).status, 403);
  assert.equal((await call(base, notesPath(ID.clientA), { token: 'tok-unlinked' })).status, 403);
  assert.equal((await call(base, notesPath(ID.clientA))).status, 401);
  assert.equal((await call(base, notesPath(ID.clientA), { token: 'tok-forged' })).status, 401);
  assert.deepEqual(noteCalls(), []);
}));

test('a note id from another client cannot be reached through an authorized client', async () => withServer(async (base) => {
  reset();
  const r = await call(base, notesPath(ID.clientA, ID.noteB1), { token: 'tok-admin', method: 'PUT', body: { content: 'Cross-client', expected_updated_at: '2026-10-21T10:00:00.000Z' } });
  assert.equal(r.status, 404);
  assert.equal(state.db.client_coach_notes.find((n) => n.id === ID.noteB1).content, 'PRIVATE-B: unrelated coach note.');
  assert.equal(noteCalls().some((c) => c.kind === 'update'), false);
  const archivedNote = await call(base, notesPath(ID.clientA, ID.noteArchived), { token: 'tok-coach-a', method: 'PUT', body: { content: 'Revive', expected_updated_at: '2026-10-19T10:00:00.000Z' } });
  assert.equal(archivedNote.status, 404);
}));

test('content and identifiers are validated before any notes query', async () => withServer(async (base) => {
  reset();
  for (const body of [{}, { content: '' }, { content: '   ' }, { content: 7 }, { content: ['x'] }, { content: 'x'.repeat(4001) }]) {
    assert.equal((await call(base, notesPath(ID.clientA), { token: 'tok-coach-a', method: 'POST', body })).status, 400);
    assert.equal((await call(base, notesPath(ID.clientA, ID.noteA1), { token: 'tok-coach-a', method: 'PUT', body: { ...body, expected_updated_at: '2026-10-20T15:00:00.000Z' } })).status, 400);
  }
  assert.equal((await call(base, notesPath(ID.clientA, ID.noteA1), { token: 'tok-coach-a', method: 'PUT', body: { content: 'No version' } })).status, 400);
  assert.equal((await call(base, notesPath('not-a-uuid'), { token: 'tok-coach-a' })).status, 404);
  assert.equal((await call(base, notesPath(ID.clientA, 'not-a-uuid'), { token: 'tok-coach-a', method: 'PUT', body: { content: 'x', expected_updated_at: 'x' } })).status, 404);
  assert.equal((await call(base, notesPath(ID.clientA), { token: 'tok-coach-a', method: 'POST', body: { content: 'x'.repeat(4000) } })).status, 201);
  assert.equal(noteCalls().filter((c) => c.kind === 'insert').length, 1);
}));

test('an archived client\'s notes are readable on request and closed to new writes', async () => withServer(async (base) => {
  reset();
  assert.equal((await call(base, notesPath(ID.archivedClient), { token: 'tok-coach-a' })).status, 404);
  const r = await call(base, `${notesPath(ID.archivedClient)}?include_archived=true`, { token: 'tok-coach-a' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.notes, []);
  assert.equal((await call(base, notesPath(ID.archivedClient), { token: 'tok-coach-a', method: 'POST', body: { content: 'Archived' } })).status, 404);
  assert.equal(noteCalls().some((c) => c.kind === 'insert'), false);
}));
