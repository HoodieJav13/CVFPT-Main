// Phase 5 operational hardening: JSON 404/error surfaces, security headers,
// Sentry gating, outbound timeouts, fail-fast config, and .env.example
// completeness. The app mounts with Supabase stubbed via the require cache.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const supabasePath = require.resolve('../src/supabase');
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: {
    supabaseAdmin: { from() { throw new Error('not needed'); }, rpc() { throw new Error('not needed'); }, auth: { admin: {} } },
    anonClient: () => ({ auth: {} }),
  },
};

const app = require('../src/app');
const server = http.createServer(app);
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); });

test('unknown routes answer JSON 404, not HTML', async () => {
  const response = await fetch(`${baseUrl}/api/no-such-route`);
  assert.equal(response.status, 404);
  assert.match(response.headers.get('content-type') || '', /application\/json/);
  assert.deepEqual(await response.json(), { error: 'Not found' });
});

test('malformed JSON bodies answer JSON 400, not an HTML error page', async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  });
  assert.equal(response.status, 400);
  assert.match(response.headers.get('content-type') || '', /application\/json/);
  assert.deepEqual(await response.json(), { error: 'Invalid request body' });
});

test('baseline security headers are present and x-powered-by is gone', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(response.headers.get('x-frame-options'));
  assert.equal(response.headers.get('x-powered-by'), null);
});

test('sentry is gated on SENTRY_DSN in both init and capture paths', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  const loggerSource = fs.readFileSync(path.join(__dirname, '../src/utils/logger.js'), 'utf8');
  assert.match(appSource, /if \(process\.env\.SENTRY_DSN\)/);
  assert.match(appSource, /sendDefaultPii: false/);
  assert.match(loggerSource, /if \(process\.env\.SENTRY_DSN\)/);
  assert.match(loggerSource, /captureException/);
});

test('outbound supabase fetches carry a default timeout, caller signals win', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/supabase.js'), 'utf8');
  assert.match(source, /AbortSignal\.timeout\(timeoutMs\)/);
  assert.match(source, /init\.signal \|\| AbortSignal\.timeout/);
  assert.match(source, /withDefaultTimeout\(createSecretKeyFetch\(SERVICE_ROLE_KEY\)\)/);
});

test('production boot fails fast on missing supabase secrets', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/supabase.js'), 'utf8');
  assert.match(source, /if \(process\.env\.VERCEL \|\| process\.env\.NODE_ENV === 'production'\) throw new Error\(message\)/);
});

test('.env.example documents every variable the email and cron systems require', () => {
  const example = fs.readFileSync(path.join(__dirname, '../.env.example'), 'utf8');
  for (const key of [
    'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
    'CORS_ORIGINS', 'FRONTEND_URL',
    'RESEND_API_KEY', 'NOTIFY_REPLY_TO', 'CRON_SECRET', 'SENTRY_DSN',
  ]) {
    assert.match(example, new RegExp(`^${key}=`, 'm'), `${key} missing from .env.example`);
  }
});

test('the migration guard workflow enforces the migration-applied label', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../../.github/workflows/migration-guard.yml'), 'utf8');
  assert.match(workflow, /supabase\/migrations\//);
  assert.match(workflow, /migration-applied/);
  assert.match(workflow, /labeled, unlabeled/);
});
