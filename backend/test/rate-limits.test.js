const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createRateLimiter, requestKey, RATE_LIMIT_MESSAGE } = require('../src/middleware/rateLimits');

test('request key prefers the authenticated user and safely normalizes IP fallback', () => {
  assert.equal(requestKey({ user: { authUserId: 'user-a' }, ip: '203.0.113.1' }), 'user:user-a');
  assert.match(requestKey({ ip: '2001:db8::1' }), /^ip:/);
});

test('rate limiter returns a generic 429 and standard headers', async (t) => {
  const app = express();
  app.set('trust proxy', 1);
  app.get('/limited', createRateLimiter({ identifier: 'test-limit', windowMs: 60_000, limit: 2 }), (_req, res) => {
    res.json({ ok: true });
  });

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/limited`;

  const first = await fetch(url);
  const second = await fetch(url);
  const blocked = await fetch(url);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).error, RATE_LIMIT_MESSAGE);
  assert.ok(blocked.headers.get('ratelimit'));
  assert.ok(blocked.headers.get('ratelimit-policy'));
  assert.equal(blocked.headers.get('x-ratelimit-limit'), null);
});
