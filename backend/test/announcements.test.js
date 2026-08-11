// Program 011 C: one-way announcements — coach scoping, admin-only
// studio-wide, client visibility rules, idempotent seen-marking, and the
// digest ride-along. Supabase + auth stubbed via the require cache.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const COACH_ID = 'aaaaaaaa-0000-0000-0000-00000000000a';
const OTHER_COACH_ID = 'abababab-0000-0000-0000-00000000000b';
const CLIENT_ID = 'cccccccc-0000-0000-0000-00000000000c';
const ANNOUNCEMENT_ID = 'dddddddd-0000-0000-0000-00000000000d';

const state = {
  inserted: [],
  announcementRow: null,
  announcementList: [],
  readUpserts: [],
};

function resetState() {
  state.inserted = [];
  state.announcementRow = null;
  state.announcementList = [];
  state.readUpserts = [];
}

const supabasePath = require.resolve('../src/supabase');
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: {
    supabaseAdmin: {
      from(table) {
        const chain = {
          select(_cols, opts) { chain._head = Boolean(opts?.head); return chain; },
          eq() { return chain; },
          or(expr) { chain._or = expr; return chain; },
          in() { return chain; },
          order() { return chain; },
          limit() { return chain; },
          insert(values) { chain._insert = values; if (table === 'announcements') state.inserted.push(values); return chain; },
          update(values) { chain._update = values; return chain; },
          upsert(values, opts) { if (table === 'announcement_reads') state.readUpserts.push({ values, opts }); return Promise.resolve({ data: values, error: null }); },
          maybeSingle() { return Promise.resolve({ data: state.announcementRow, error: null }); },
          single() {
            if (chain._insert) return Promise.resolve({ data: { id: ANNOUNCEMENT_ID, ...chain._insert }, error: null });
            if (chain._update) return Promise.resolve({ data: { ...state.announcementRow, ...chain._update }, error: null });
            return Promise.resolve({ data: null, error: null });
          },
          then(resolve) {
            if (chain._head) return resolve({ count: 3, error: null });
            if (table === 'announcements') return resolve({ data: state.announcementList, error: null });
            if (table === 'announcement_reads') return resolve({ data: [{ announcement_id: ANNOUNCEMENT_ID }], error: null });
            return resolve({ data: [], error: null });
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
  exports: {
    requireAuth: (req, _res, next) => { req.user = currentUser; next(); },
    requireCoach: (req, res, next) => (['coach', 'admin'].includes(req.user?.role) ? next() : res.status(403).json({ error: 'Coach access required' })),
    requireClient: (req, res, next) => (req.user?.role === 'client' ? next() : res.status(403).json({ error: 'Client access required' })),
    canAccessClient: () => true,
  },
};

const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/announcements', require('../src/routes/announcements'));
const server = http.createServer(app);
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); });

async function send(pathname, { method = 'POST', body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method, headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const coachUser = { role: 'coach', coach: { id: COACH_ID } };
const adminUser = { role: 'admin', coach: { id: COACH_ID } };
const clientUser = { role: 'client', client: { id: CLIENT_ID, coach_id: COACH_ID } };

test('coach posts to own clients; studio-wide is admin-only', async () => {
  resetState();
  currentUser = coachUser;
  let result = await send('/api/announcements', { body: { content: 'Gym closes early Friday.' } });
  assert.equal(result.status, 201);
  assert.equal(state.inserted[0].coach_id, COACH_ID);
  assert.equal(state.inserted[0].studio_wide, false);

  result = await send('/api/announcements', { body: { content: 'Everyone!', studio_wide: true } });
  assert.equal(result.status, 403);

  currentUser = adminUser;
  result = await send('/api/announcements', { body: { content: 'Everyone!', studio_wide: true } });
  assert.equal(result.status, 201);
  assert.equal(state.inserted.at(-1).studio_wide, true);
});

test('empty content refuses; content is capped', async () => {
  resetState();
  currentUser = coachUser;
  const result = await send('/api/announcements', { body: { content: '   ' } });
  assert.equal(result.status, 400);
  await send('/api/announcements', { body: { content: 'x'.repeat(5000) } });
  assert.equal(state.inserted[0].content.length, 2000);
});

test('coach list carries seen and audience counts', async () => {
  resetState();
  currentUser = coachUser;
  state.announcementList = [{ id: ANNOUNCEMENT_ID, coach_id: COACH_ID, content: 'Hi', studio_wide: false, archived: false }];
  const { status, body } = await send('/api/announcements', { method: 'GET' });
  assert.equal(status, 200);
  assert.equal(body[0].seen_count, 1);
  assert.equal(body[0].audience_count, 3);
});

test('client visibility filters to own coach or studio-wide', async () => {
  resetState();
  currentUser = clientUser;
  state.announcementList = [{ id: ANNOUNCEMENT_ID, content: 'Hi', studio_wide: false, created_at: 'now', coach: { id: COACH_ID, name: 'Sam' } }];
  const { status, body } = await send('/api/announcements/mine', { method: 'GET' });
  assert.equal(status, 200);
  assert.equal(body[0].read, true);
  // The visibility OR-filter names the caller's coach — never client input.
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/announcements.js'), 'utf8');
  assert.match(source, /or\(`coach_id\.eq\.\$\{req\.user\.client\.coach_id\},studio_wide\.eq\.true`\)/);
});

test('read marking is idempotent and masked for other coaches\' posts', async () => {
  resetState();
  currentUser = clientUser;
  state.announcementRow = { id: ANNOUNCEMENT_ID, coach_id: COACH_ID, studio_wide: false };
  let result = await send(`/api/announcements/${ANNOUNCEMENT_ID}/read`, { method: 'PATCH' });
  assert.equal(result.status, 200);
  assert.equal(state.readUpserts[0].opts.ignoreDuplicates, true);

  state.announcementRow = { id: ANNOUNCEMENT_ID, coach_id: OTHER_COACH_ID, studio_wide: false };
  result = await send(`/api/announcements/${ANNOUNCEMENT_ID}/read`, { method: 'PATCH' });
  assert.equal(result.status, 404);
});

test('archive is author-or-admin only', async () => {
  resetState();
  currentUser = coachUser;
  state.announcementRow = { id: ANNOUNCEMENT_ID, coach_id: OTHER_COACH_ID, studio_wide: false, archived: false };
  let result = await send(`/api/announcements/${ANNOUNCEMENT_ID}/archive`, { method: 'PATCH' });
  assert.equal(result.status, 404);

  currentUser = adminUser;
  result = await send(`/api/announcements/${ANNOUNCEMENT_ID}/archive`, { method: 'PATCH' });
  assert.equal(result.status, 200);
  assert.equal(result.body.archived, true);
});

test('digest rides along: unseen announcements add a client fact, never an email of their own', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/email.js'), 'utf8');
  assert.match(source, /announcements ride the digest, never a standalone email/i);
  assert.match(source, /counts\.announcements === 1 \? 'announcement' : 'announcements'\} from your coach/);
  // No sendEmail call keyed to announcements exists.
  assert.doesNotMatch(source, /sendEmail\([^)]*announcement/i);
  const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20260810210000_announcements.sql'), 'utf8');
  assert.match(migration, /unique\(announcement_id, client_id\)/);
  assert.match(migration, /grant select, insert on table public\.announcement_reads to service_role/);
});
