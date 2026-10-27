const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { isSafeExternalVideoUrl, unsafeExternalVideoUrls } = require('../src/lib/externalVideo');

test('external video links: only plain http(s), bounded, no credentials; YouTube stays an external link', () => {
  for (const ok of ['https://www.youtube.com/watch?v=abc', 'https://youtu.be/abc', 'http://example.com/demo', ' https://example.com/x ']) assert.equal(isSafeExternalVideoUrl(ok), true, ok);
  for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'vbscript:x', '//evil.example', 'ftp://example.com/x',
    'https://user:pass@example.com/', `https://example.com/${'a'.repeat(2050)}`, 'not a url', 42, {}]) assert.equal(isSafeExternalVideoUrl(bad), false, String(bad));
});

test('unsafe new values are reported; empty and unchanged legacy values are allowed', () => {
  const previous = new Map([['we1', 'javascript:legacy()']]);
  const rows = [
    { id: 'we1', video_url: 'javascript:legacy()' },
    { id: 'we2', video_url: '' },
    { id: 'we3', video_url: null },
    { id: 'we4', video_url: 'https://youtu.be/ok' },
    { video_url: 'data:text/html,x' },
    { id: 'we1x', video_url: 'javascript:new()' },
  ];
  assert.deepEqual(unsafeExternalVideoUrls(rows, previous), [4, 5]);
});

// Mounted library writes with the auth/db stubbed like the other mounted tests.
const writes = [];
const dbPath = require.resolve('../src/supabase');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { supabaseAdmin: {
  from() {
    let payload;
    const chain = {
      insert(value) { payload = value; writes.push(value); return chain; }, update(value) { payload = value; writes.push(value); return chain; },
      select() { return chain; }, eq() { return chain; },
      single: async () => ({ data: { id: 'lib1', ...(Array.isArray(payload) ? payload[0] : payload) }, error: null }),
      maybeSingle: async () => ({ data: { id: 'lib1', video_url: 'javascript:legacy()', ...(Array.isArray(payload) ? payload[0] : payload) }, error: null }),
      then(resolve) { return resolve({ data: Array.isArray(payload) ? payload : [payload], error: null }); },
    };
    return chain;
  },
} } };
const authPath = require.resolve('../src/middleware/auth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: {
  requireAuth(req, _res, next) { req.user = { role: 'coach', coach: { id: 'coach-a' } }; next(); },
  requireCoach(_req, _res, next) { next(); }, requireClient(_req, _res, next) { next(); }, canAccessClient: () => true,
} };
const app = express(); app.use(express.json()); app.use('/api/programs', require('../src/routes/programs'));
let server; let base;
test.before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}/api/programs`; });
test.after(() => new Promise((resolve) => server.close(resolve)));
const send = async (method, url, body) => { const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: res.status, body: await res.json() }; };

test('library writes refuse new unsafe external links before any write', async () => {
  writes.length = 0;
  assert.equal((await send('POST', '/exercise-library', { name: 'Synthetic', video_url: 'javascript:alert(1)' })).status, 400);
  assert.equal((await send('PUT', '/exercise-library/lib1', { video_url: 'data:text/html,x' })).status, 400);
  assert.equal((await send('POST', '/exercise-library/import', { rows: [{ name: 'A', video_url: 'https://youtu.be/a' }, { name: 'B', video_url: 'file:///etc/passwd' }] })).status, 400);
  assert.equal(writes.length, 0);
  assert.equal((await send('POST', '/exercise-library', { name: 'Synthetic', video_url: 'https://youtu.be/a' })).status, 201);
  // Re-saving an unchanged legacy value is not a new write of unsafe data.
  assert.equal((await send('PUT', '/exercise-library/lib1', { name: 'Renamed', video_url: 'javascript:legacy()' })).status, 200);
});
