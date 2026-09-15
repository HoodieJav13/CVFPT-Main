// The account-recovery routes are rate-limited at the mounted boundary
// (rateLimits.js: forgot 5/h, reset 10/h). These run in their own process
// (node --test isolates files) so the limiter counters start at zero.
// Email is stubbed unconfigured and the request bodies are invalid on
// purpose: the limiter must trip on request count alone, before any
// account lookup or provider call, so an attacker gets nothing to enumerate.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const supabasePath = require.resolve('../src/supabase');
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: {
    supabaseAdmin: { from() { throw new Error('database must not be touched'); }, auth: { admin: {} } },
    anonClient: () => ({ auth: { verifyOtp: () => Promise.resolve({ data: null, error: { message: 'invalid' } }) } }),
  },
};
const emailPath = require.resolve('../src/services/email');
require.cache[emailPath] = {
  id: emailPath, filename: emailPath, loaded: true,
  exports: { configured: () => false, sendEmail: () => Promise.resolve(), renderEmail: () => ({}), dispatchEmail: () => Promise.resolve() },
};

const express = require('express');
const { RATE_LIMIT_MESSAGE } = require('../src/middleware/rateLimits');
const authRouter = require('../src/routes/auth');

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);
const server = http.createServer(app);
let baseUrl;
test.before(async () => {
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); });

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}

test('forgot-password: the sixth request in the window is a 429, and unconfigured email is a 503 before it', async () => {
  for (let i = 0; i < 5; i += 1) {
    const { status } = await post('/api/auth/forgot-password', { email: 'sam@x.com' });
    assert.equal(status, 503, `request ${i + 1} should answer 503 (email unconfigured), got ${status}`);
  }
  const blocked = await post('/api/auth/forgot-password', { email: 'sam@x.com' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error, RATE_LIMIT_MESSAGE);
  assert.ok(blocked.headers.get('ratelimit'), 'draft-8 RateLimit header expected');
});

test('reset-password: the eleventh request in the window is a 429', async () => {
  for (let i = 0; i < 10; i += 1) {
    const { status } = await post('/api/auth/reset-password', { token: 'bad', password: 'longenough1' });
    assert.equal(status, 400, `request ${i + 1} should answer 400 (invalid token), got ${status}`);
  }
  const blocked = await post('/api/auth/reset-password', { token: 'bad', password: 'longenough1' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error, RATE_LIMIT_MESSAGE);
});
