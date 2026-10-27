// Capability content streaming lifecycle: a browser that abandons a media
// request while the server is still re-authorizing it must not leave the
// opened file stream stalled. Node >= 26 treats a FileHandle closed by garbage
// collection as a fatal error, so a stalled stream would crash the API.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { randomUUID } = require('node:crypto');

process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
const { LocalMediaStore } = require('../src/services/exerciseMedia/localStore');
const { createExerciseMediaRouter } = require('../src/routes/exerciseMedia');

const store = new LocalMediaStore({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'cvf-content-stream-')) });
const key = `derivatives/${randomUUID()}/1-poster.jpg`;
const opened = [];
let authorizeDelayMs = 0;

const service = {
  async openContent(_token, rangeHeader) {
    await new Promise((resolve) => setTimeout(resolve, authorizeDelayMs));
    const { size } = await store.stat(key);
    const range = rangeHeader ? { start: 0, end: 9 } : null;
    const result = await store.open({ key, range });
    opened.push(result.stream);
    return { status: range ? 206 : 200, stream: result.stream, size, range, contentType: 'image/jpeg', ext: 'jpg', maxAge: 60 };
  },
};
const app = express();
app.use('/api/exercise-media', createExerciseMediaRouter({
  getRuntime: () => ({ service, store }),
  requireAuth: (_req, _res, next) => next(),
  requireCoach: (_req, _res, next) => next(),
  limiters: { upload: (_q, _s, n) => n(), process: (_q, _s, n) => n(), frame: (_q, _s, n) => n(), links: (_q, _s, n) => n() },
}));
let server; let port;
test.before(async () => {
  await store.putObject({ key, buffer: Buffer.alloc(512 * 1024, 7), maxBytes: 1024 * 1024 });
  server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve)); port = server.address().port;
});
test.after(() => new Promise((resolve) => server.close(resolve)));

function abortedRequest(method, headers = {}) {
  return new Promise((resolve) => {
    const request = http.request({ host: '127.0.0.1', port, method, path: '/api/exercise-media/content/synthetic.token', headers });
    request.on('error', () => resolve());
    request.end();
    // Abandon while the server is still authorizing.
    setTimeout(() => { request.destroy(); resolve(); }, 20);
  });
}

const settle = async () => { for (let i = 0; i < 50 && opened.some((stream) => !stream.destroyed); i += 1) await new Promise((resolve) => setTimeout(resolve, 20)); };

test('an abandoned GET/Range request never leaves its file stream open', async () => {
  authorizeDelayMs = 120;
  opened.length = 0;
  await abortedRequest('GET');
  await abortedRequest('GET', { range: 'bytes=0-9' });
  await new Promise((resolve) => setTimeout(resolve, authorizeDelayMs + 50));
  await settle();
  assert.equal(opened.length, 2);
  assert.deepEqual(opened.map((stream) => stream.destroyed), [true, true], 'every opened stream is released');
});

test('completed GET, HEAD and Range responses still deliver exact bytes', async () => {
  authorizeDelayMs = 0;
  opened.length = 0;
  const base = `http://127.0.0.1:${port}/api/exercise-media/content/synthetic.token`;
  const full = await fetch(base);
  assert.equal(full.status, 200);
  assert.equal((await full.arrayBuffer()).byteLength, 512 * 1024);
  const head = await fetch(base, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(512 * 1024));
  const range = await fetch(base, { headers: { range: 'bytes=0-9' } });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 10);
  await settle();
  assert.ok(opened.every((stream) => stream.destroyed));
});
