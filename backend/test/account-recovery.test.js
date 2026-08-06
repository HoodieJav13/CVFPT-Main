// Mounted-route tests for account recovery: the real auth and clients
// routers run on a real HTTP server with the Supabase client, auth
// middleware, and email service stubbed via the per-process require cache.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const COACH_ID = 'aaaaaaaa-0000-0000-0000-00000000000a';
const CLIENT_ID = 'cccccccc-0000-0000-0000-00000000000c';
const AUTH_USER_ID = 'dddddddd-0000-0000-0000-00000000000d';
const TOKEN_HASH = 'tok_recovery_abcdef1234567890abcdef';

const state = {
  emailConfigured: true,
  sentEmails: [],
  coachByEmail: null,
  clientByEmail: null,
  clientRow: null,
  generateLinkCalls: [],
  generateLinkResult: { data: { properties: { hashed_token: TOKEN_HASH } }, error: null },
  updateUserCalls: [],
  updateUserResult: { data: {}, error: null },
  verifyOtpResult: { data: null, error: { message: 'invalid' } },
  signInResult: { data: null, error: { message: 'bad credentials' } },
};

function resetState() {
  state.emailConfigured = true;
  state.sentEmails = [];
  state.coachByEmail = null;
  state.clientByEmail = null;
  state.clientRow = null;
  state.generateLinkCalls = [];
  state.generateLinkResult = { data: { properties: { hashed_token: TOKEN_HASH } }, error: null };
  state.updateUserCalls = [];
  state.updateUserResult = { data: {}, error: null };
  state.verifyOtpResult = { data: null, error: { message: 'invalid' } };
  state.signInResult = { data: null, error: { message: 'bad credentials' } };
}

const supabasePath = require.resolve('../src/supabase');
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: {
    supabaseAdmin: {
      from(table) {
        const chain = {
          select() { return chain; },
          eq() { return chain; },
          not() { return chain; },
          ilike() { chain._ilike = true; return chain; },
          order() { return chain; },
          limit() { return chain; },
          is() { return chain; },
          update(values) { chain._update = values; return chain; },
          maybeSingle() {
            if (table === 'coaches') return Promise.resolve({ data: state.coachByEmail, error: null });
            if (table === 'clients' && chain._ilike) return Promise.resolve({ data: state.clientByEmail, error: null });
            if (table === 'clients') return Promise.resolve({ data: state.clientRow, error: null });
            return Promise.resolve({ data: null, error: null });
          },
          single() {
            if (table === 'clients' && chain._update) {
              return Promise.resolve({ data: { ...state.clientRow, ...chain._update }, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
        };
        return chain;
      },
      auth: {
        admin: {
          generateLink(args) {
            state.generateLinkCalls.push(args);
            return Promise.resolve(state.generateLinkResult);
          },
          updateUserById(id, attrs) {
            state.updateUserCalls.push({ id, attrs });
            return Promise.resolve(state.updateUserResult);
          },
        },
      },
    },
    anonClient: () => ({
      auth: {
        verifyOtp: () => Promise.resolve(state.verifyOtpResult),
        signInWithPassword: () => Promise.resolve(state.signInResult),
      },
    }),
  },
};

let currentUser;
const authPath = require.resolve('../src/middleware/auth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: {
    requireAuth: (req, _res, next) => { req.user = currentUser; next(); },
    requireCoach: (req, res, next) => (req.user?.role === 'coach' || req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Coach access required' })),
    requireClient: (req, res, next) => (req.user?.role === 'client' ? next() : res.status(403).json({ error: 'Client access required' })),
    requireAdmin: (_req, _res, next) => next(),
    canAccessClient: () => true,
  },
};

const emailPath = require.resolve('../src/services/email');
require.cache[emailPath] = {
  id: emailPath, filename: emailPath, loaded: true,
  exports: {
    configured: () => state.emailConfigured,
    sendEmail: (message, idempotencyKey) => {
      state.sentEmails.push({ message, idempotencyKey });
      return Promise.resolve({ id: 'em_test' });
    },
    renderEmail: ({ headline, intro, actionLabel, actionUrl }) => ({
      text: [headline, intro, `${actionLabel}: ${actionUrl}`].join('\n'),
      html: `<a href="${actionUrl}">${actionLabel}</a>`,
    }),
    dispatchEmail: (task) => Promise.resolve().then(task),
  },
};

const express = require('express');
const authRouter = require('../src/routes/auth');
const clientsRouter = require('../src/routes/clients');

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);
app.use('/api/clients', clientsRouter);
const server = http.createServer(app);
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); });

async function post(path, body, method = 'POST') {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const coachUser = { role: 'coach', coach: { id: COACH_ID, name: 'Coach Sam' }, email: 'sam@x.com', authUserId: AUTH_USER_ID };

test('forgot-password: known coach email sends a reset carrying the token hash', async () => {
  resetState();
  state.coachByEmail = { id: COACH_ID, name: 'Coach Sam', email: 'sam@x.com' };
  const { status, body } = await post('/api/auth/forgot-password', { email: 'Sam@X.com' });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(state.generateLinkCalls.length, 1);
  assert.equal(state.generateLinkCalls[0].email, 'sam@x.com');
  assert.equal(state.sentEmails.length, 1);
  assert.ok(state.sentEmails[0].message.text.includes(`/reset-password?token=${encodeURIComponent(TOKEN_HASH)}`));
  assert.deepEqual(state.sentEmails[0].message.to, ['sam@x.com']);
});

test('forgot-password: unknown email answers 200 with zero emails', async () => {
  resetState();
  const { status, body } = await post('/api/auth/forgot-password', { email: 'stranger@x.com' });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(state.generateLinkCalls.length, 0);
  assert.equal(state.sentEmails.length, 0);
});

test('forgot-password: unconfigured email service answers 503 before any lookup', async () => {
  resetState();
  state.emailConfigured = false;
  state.coachByEmail = { id: COACH_ID, name: 'Coach Sam', email: 'sam@x.com' };
  const { status } = await post('/api/auth/forgot-password', { email: 'sam@x.com' });
  assert.equal(status, 503);
  assert.equal(state.generateLinkCalls.length, 0);
  assert.equal(state.sentEmails.length, 0);
});

test('reset-password: invalid token or short password never updates', async () => {
  resetState();
  let result = await post('/api/auth/reset-password', { token: 'bad', password: 'longenough1' });
  assert.equal(result.status, 400);
  assert.ok(result.body.error.includes('invalid or has expired'));
  assert.equal(state.updateUserCalls.length, 0);

  result = await post('/api/auth/reset-password', { token: TOKEN_HASH, password: 'short' });
  assert.equal(result.status, 400);
  assert.equal(state.updateUserCalls.length, 0);
});

test('reset-password: valid token sets the new password for the verified user', async () => {
  resetState();
  state.verifyOtpResult = { data: { user: { id: AUTH_USER_ID } }, error: null };
  const { status, body } = await post('/api/auth/reset-password', { token: TOKEN_HASH, password: 'new-password-1' });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(state.updateUserCalls, [{ id: AUTH_USER_ID, attrs: { password: 'new-password-1' } }]);
});

test('change-password: wrong current password is a 401 with no update', async () => {
  resetState();
  currentUser = coachUser;
  const { status } = await post('/api/auth/change-password', { current_password: 'wrong', new_password: 'new-password-1' });
  assert.equal(status, 401);
  assert.equal(state.updateUserCalls.length, 0);
});

test('change-password: verified current password updates the caller only', async () => {
  resetState();
  currentUser = coachUser;
  state.signInResult = { data: { user: { id: AUTH_USER_ID } }, error: null };
  const { status, body } = await post('/api/auth/change-password', { current_password: 'old-password', new_password: 'new-password-1' });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(state.updateUserCalls, [{ id: AUTH_USER_ID, attrs: { password: 'new-password-1' } }]);
});

test('invite toggle: sends the invite email and reports invite_email sent', async () => {
  resetState();
  currentUser = coachUser;
  state.clientRow = {
    id: CLIENT_ID, name: 'Jo Client', email: 'jo@x.com', auth_user_id: null,
    invited: false, archived: false, updated_at: '2026-08-06T00:00:00.000Z',
  };
  const { status, body } = await post(`/api/clients/${CLIENT_ID}/invite`, { invited: true }, 'PATCH');
  assert.equal(status, 200);
  assert.equal(body.invite_email, 'sent');
  assert.equal(state.sentEmails.length, 1);
  assert.deepEqual(state.sentEmails[0].message.to, ['jo@x.com']);
  assert.ok(state.sentEmails[0].message.text.includes('/signup?email=jo%40x.com'));
});

test('invite toggle: unconfigured email reports invite_email unconfigured', async () => {
  resetState();
  currentUser = coachUser;
  state.emailConfigured = false;
  state.clientRow = {
    id: CLIENT_ID, name: 'Jo Client', email: 'jo@x.com', auth_user_id: null,
    invited: false, archived: false, updated_at: '2026-08-06T00:00:00.000Z',
  };
  const { status, body } = await post(`/api/clients/${CLIENT_ID}/invite`, { invited: true }, 'PATCH');
  assert.equal(status, 200);
  assert.equal(body.invite_email, 'unconfigured');
  assert.equal(state.sentEmails.length, 0);
});

test('send-password-reset: unclaimed client is a 400 with no email', async () => {
  resetState();
  currentUser = coachUser;
  state.clientRow = { id: CLIENT_ID, name: 'Jo Client', email: 'jo@x.com', auth_user_id: null, archived: false };
  const { status } = await post(`/api/clients/${CLIENT_ID}/send-password-reset`, {});
  assert.equal(status, 400);
  assert.equal(state.sentEmails.length, 0);
});

test('send-password-reset: claimed client gets a reset email', async () => {
  resetState();
  currentUser = coachUser;
  state.clientRow = { id: CLIENT_ID, name: 'Jo Client', email: 'jo@x.com', auth_user_id: AUTH_USER_ID, archived: false };
  const { status, body } = await post(`/api/clients/${CLIENT_ID}/send-password-reset`, {});
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(state.sentEmails.length, 1);
  assert.deepEqual(state.sentEmails[0].message.to, ['jo@x.com']);
});

test('client email edit on a claimed account syncs the auth email; duplicates 409', async () => {
  resetState();
  currentUser = coachUser;
  state.clientRow = { id: CLIENT_ID, name: 'Jo Client', email: 'jo@x.com', auth_user_id: AUTH_USER_ID, archived: false };
  let result = await post(`/api/clients/${CLIENT_ID}`, { email: 'new@x.com' }, 'PUT');
  assert.equal(result.status, 200);
  assert.deepEqual(state.updateUserCalls, [{ id: AUTH_USER_ID, attrs: { email: 'new@x.com', email_confirm: true } }]);

  resetState();
  currentUser = coachUser;
  state.clientRow = { id: CLIENT_ID, name: 'Jo Client', email: 'jo@x.com', auth_user_id: AUTH_USER_ID, archived: false };
  state.updateUserResult = { data: null, error: { message: 'A user with this email address has already been registered' } };
  result = await post(`/api/clients/${CLIENT_ID}`, { email: 'taken@x.com' }, 'PUT');
  assert.equal(result.status, 409);
});
