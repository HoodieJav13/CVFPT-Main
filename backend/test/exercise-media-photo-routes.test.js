// Mounted photo-transport routes (docs/exercise-guides/design.md): the local
// signed staging PUT (no bearer header, grant-authorized, bounded, never
// overwriting) and the coach-only intent/finalize/abandon/resume endpoints.
// The service is a recording stub here; its behavior is covered by
// exercise-media-photo-uploads.test.js and the real-stack integration lane.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { randomUUID } = require('node:crypto');

process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
const { LocalMediaStore } = require('../src/services/exerciseMedia/localStore');
const { HttpError } = require('../src/lib/exerciseMedia/service');
const { createExerciseMediaRouter } = require('../src/routes/exerciseMedia');

let clock = Date.now();
const store = new LocalMediaStore({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'cvf-photo-routes-')), grantSecret: 'synthetic-local-grant-secret-0123456789abcdef', now: () => clock });
const calls = [];
let authCalls = 0;
let limiterCalls = 0;
let user = { role: 'coach', coach: { id: randomUUID() } };
const service = {
  issueUpload: async (...args) => { calls.push(['issueUpload', ...args]); return { intent: { id: 'i1', state: 'issued' }, upload: { method: 'PUT', url: '/x' }, replayed: args[2].request_id === 'replay' }; },
  finalizeUpload: async (...args) => { calls.push(['finalizeUpload', ...args]); return { status: 201, body: { revision: { id: args[1] }, replayed: false } }; },
  abandonUpload: async (...args) => { calls.push(['abandonUpload', ...args]); return { id: args[2], state: 'abandoned' }; },
  resumeProcessing: async (...args) => { calls.push(['resumeProcessing', ...args]); return { id: args[1], status: 'ready' }; },
  prepareUpload: async () => { throw new HttpError(409, 'video_sources_disabled'); },
};
const app = express();
app.use(express.json());
app.use('/api/exercise-media', createExerciseMediaRouter({
  getRuntime: () => ({ service, store }),
  requireAuth: (req, _res, next) => { authCalls += 1; req.user = user; next(); },
  requireCoach: (req, res, next) => (['coach', 'admin'].includes(req.user.role) ? next() : res.status(403).json({ error: 'Coach access required' })),
  limiters: { upload: (_req, _res, next) => { limiterCalls += 1; next(); }, process: (_req, _res, next) => next(), frame: (_req, _res, next) => next(), links: (_req, _res, next) => next() },
}));
let server; let base;
test.before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => new Promise((resolve) => server.close(resolve)));

const put = (url, body, headers = {}) => fetch(`${base}${url}`, { method: 'PUT', headers: { 'content-type': 'image/jpeg', ...headers }, body });
const post = async (url, json) => {
  const response = await fetch(`${base}/api/exercise-media${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json || {}) });
  return { status: response.status, body: await response.json() };
};

test('staging PUT is authorized by its grant alone, bounded and never overwrites', async () => {
  const key = `staging/${randomUUID()}`;
  const grant = store.createUploadGrant({ key, contentType: 'image/jpeg' });
  const before = authCalls;
  const first = await put(grant.url, Buffer.from('synthetic bytes'));
  assert.equal(first.status, 201);
  assert.deepEqual(await first.json(), { status: 'stored', bytes: 15 });
  assert.equal(authCalls, before, 'no bearer session is used for the direct upload');
  assert.equal(first.headers.get('cache-control'), 'private, no-store');
  const again = await put(grant.url, Buffer.from('synthetic bytes'));
  assert.equal(again.status, 200);
  const conflict = await put(grant.url, Buffer.from('other synthetic bytes'));
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, 'staging_conflict');
  assert.deepEqual(await store.readStaged(key, { maxBytes: 100 }), Buffer.from('synthetic bytes'));

  assert.equal((await put(`${grant.url.slice(0, -3)}abc`, Buffer.from('x'))).status, 404);
  const html = await put(store.createUploadGrant({ key: `staging/${randomUUID()}`, contentType: 'image/jpeg' }).url, Buffer.from('<html>'), { 'content-type': 'text/html' });
  assert.equal(html.status, 415);
  const tooBig = store.createUploadGrant({ key: `staging/${randomUUID()}`, contentType: 'image/jpeg' });
  const big = await put(tooBig.url, Buffer.alloc(10 * 1024 * 1024 + 1));
  assert.equal(big.status, 413);
  const expiring = store.createUploadGrant({ key: `staging/${randomUUID()}`, contentType: 'image/png' });
  clock += 16 * 60 * 1000;
  const expired = await put(expiring.url, Buffer.from('late'), { 'content-type': 'image/png' });
  assert.equal(expired.status, 403);
  clock = Date.now();
});

test('intent, finalize, abandon and resume are coach-only and map to the service', async () => {
  user = { role: 'coach', coach: { id: randomUUID() } };
  const revisionId = randomUUID();
  const issued = await post(`/revisions/${revisionId}/uploads`, { request_id: 'fresh', role: 'source_image' });
  assert.equal(issued.status, 201);
  assert.equal(limiterCalls > 0, true, 'upload rate limit applies to grants');
  assert.equal((await post(`/revisions/${revisionId}/uploads`, { request_id: 'replay' })).status, 200);
  assert.equal((await post(`/revisions/${revisionId}/uploads/i1/finalize`, { expected_version: 2 })).status, 201);
  assert.deepEqual((await post(`/revisions/${revisionId}/uploads/i1/abandon`)).body, { id: 'i1', state: 'abandoned' });
  assert.equal((await post(`/revisions/${revisionId}/process/resume`)).body.status, 'ready');
  assert.deepEqual(calls.map((call) => call[0]), ['issueUpload', 'issueUpload', 'finalizeUpload', 'abandonUpload', 'resumeProcessing']);
  assert.deepEqual(calls[2].slice(2), [revisionId, 'i1', { expected_version: 2 }]);
  user = { role: 'client', client: { id: randomUUID() } };
  for (const url of [`/revisions/${revisionId}/uploads`, `/revisions/${revisionId}/uploads/i1/finalize`, `/revisions/${revisionId}/uploads/i1/abandon`, `/revisions/${revisionId}/process/resume`]) {
    assert.equal((await post(url, {})).status, 403, url);
  }
  user = { role: 'coach', coach: { id: randomUUID() } };
  const video = await fetch(`${base}/api/exercise-media/revisions/${revisionId}/sources?role=source_video`, { method: 'POST' });
  assert.equal(video.status, 409);
  const body = await video.json();
  assert.equal(body.code, 'video_sources_disabled');
  assert.match(body.error, /photo/i);
});
