// Mounted /api/exercise-media router with the REAL requireAuth/requireCoach
// middleware (over a stubbed Supabase auth/profile lookup), the real service,
// a real LocalMediaStore and real capability signer. SQL state transitions are
// proven separately by supabase/tests/exercise_media; here the repository is a
// recording fake so the HTTP boundary can be asserted exactly.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { createCanvas } = require('@napi-rs/canvas');

const id = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const users = {
  'token-coach-a': { auth: { id: id(101), email: 'a@example.invalid' }, coach: { id: id(901), name: 'Coach A', is_admin: false, archived: false } },
  'token-coach-b': { auth: { id: id(102), email: 'b@example.invalid' }, coach: { id: id(902), name: 'Coach B', is_admin: false, archived: false } },
  'token-admin': { auth: { id: id(103), email: 'admin@example.invalid' }, coach: { id: id(903), name: 'Admin', is_admin: true, archived: false } },
  'token-client': { auth: { id: id(104), email: 'c@example.invalid' }, client: { id: id(801), coach_id: id(901), archived: false, auth_user_id: id(104) } },
};
const dbPath = require.resolve('../src/supabase');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { supabaseAdmin: {
  auth: { getUser: async (token) => (users[token] ? { data: { user: users[token].auth }, error: null } : { data: null, error: { message: 'invalid' } }) },
  from(table) {
    const filters = {};
    const chain = {
      select: () => chain, eq: (key, value) => { filters[key] = value; return chain; },
      maybeSingle: async () => {
        const entry = Object.values(users).find((u) => u.auth.id === filters.auth_user_id);
        const row = table === 'coaches' ? entry?.coach : table === 'clients' ? entry?.client : null;
        return { data: row ? { ...row, auth_user_id: filters.auth_user_id } : null, error: null };
      },
    };
    return chain;
  },
} } };

const { requireAuth, requireCoach } = require('../src/middleware/auth');
const { createExerciseMediaRouter } = require('../src/routes/exerciseMedia');
const { createExerciseMediaService } = require('../src/lib/exerciseMedia/service');
const { LocalMediaStore } = require('../src/services/exerciseMedia/localStore');
const { createCapabilitySigner } = require('../src/services/exerciseMedia/capabilities');

const EX = id(1);
let state; let rpcCalls; let clock; let store; let processorCalls; let enabled = true; let stageCalls;
function reset() {
  rpcCalls = []; processorCalls = []; stageCalls = 0; clock = 1_800_000_000_000; enabled = true;
  state = {
    revisions: {
      [id(301)]: { id: id(301), exercise_library_id: EX, uploaded_by_coach_id: id(901), status: 'draft', review_status: 'needs_review', version: 1, recipe_version: 1, archived: false, published_at: null, poster_mode: null, cues: [], caption_cues: [] },
      [id(311)]: { id: id(311), exercise_library_id: EX, uploaded_by_coach_id: id(901), status: 'ready', review_status: 'approved', version: 4, recipe_version: 2, archived: false, published_at: '2026-10-15T00:00:00Z', cues: [], caption_cues: [], transcript: 'Synthetic transcript' },
    },
    assets: { [id(401)]: { id: id(401), revision_id: id(311), role: 'poster', storage_key: `derivatives/${id(311)}/2-poster.jpg`, mime_type: 'image/jpeg', width: 640, height: 360, bytes: 2000, archived: false } },
    current: { revision_id: id(311), version: 1, owner_id: id(901) },
    log: { id: id(501), client_id: id(801), archived: false, client: { id: id(801), coach_id: id(901), archived: false } },
    rpc: {},
  };
}
const repo = {
  rpc: async (name, args) => { rpcCalls.push({ name, args }); const handler = state.rpc[name]; if (!handler) throw new Error(`unexpected rpc ${name}`); return handler(args); },
  coach: async (key) => Object.values(users).find((u) => u.coach?.id === key)?.coach || null,
  client: async (key) => Object.values(users).find((u) => u.client?.id === key)?.client || null,
  exercise: async (key) => (key === EX ? { id: EX, name: 'Synthetic Goblet Squat', archived: false } : null),
  revision: async (key) => state.revisions[key] || null,
  revisionsForExercise: async () => Object.values(state.revisions).filter((r) => !r.published_at),
  assetsFor: async (ids) => Object.values(state.assets).filter((a) => ids.includes(a.revision_id) && !a.archived),
  asset: async (key) => state.assets[key] || null,
  current: async () => state.current,
  latestJob: async () => null,
  coachNames: async () => new Map(),
  libraryStatus: async () => [],
  bundle: async (ids) => (ids.includes(EX) && state.current.revision_id === id(311)
    ? [{ exercise_library_id: EX, revision_id: id(311), version: state.current.version, alt_text: 'Synthetic photo', cues: [], assets: [{ id: id(401), role: 'poster', width: 640, height: 360 }] }] : []),
  workoutLog: async (key) => (key === state.log.id && !state.log.archived ? state.log : null),
  logExerciseLibraryIds: async () => new Set([EX]),
};
const processor = {
  version: 'test-processor',
  verifyImage: async () => { processorCalls.push('verifyImage'); return true; },
  probe: async () => { processorCalls.push('probe'); return { durationMs: 6000, width: 1280, height: 720, fps: 30, videoCodec: 'h264', hasAudio: false, rotation: 0 }; },
};

let server; let base;
test.before(async () => {
  store = new LocalMediaStore({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'cvf-media-routes-')) });
  const realStage = store.stageUpload.bind(store);
  store.stageUpload = (...args) => { stageCalls += 1; return realStage(...args); };
  const signer = createCapabilitySigner({ secret: 's'.repeat(40), now: () => clock });
  const service = createExerciseMediaService({ repo, store, processor, signer, now: () => clock });
  const pass = (_req, _res, next) => next();
  const app = express();
  app.use(express.json());
  app.use('/api/exercise-media', createExerciseMediaRouter({
    getRuntime: () => (enabled ? { service, store, repo } : null), requireAuth, requireCoach,
    limiters: { upload: pass, process: pass, frame: pass, links: pass },
  }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/exercise-media`;
});
test.after(() => new Promise((resolve) => server.close(resolve)));

const call = async (method, url, { token, body: rawBody, headers = {} } = {}) => {
  const body = ['GET', 'HEAD'].includes(method) ? undefined : rawBody;
  const res = await fetch(base + url, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...headers }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
};
const jpeg = () => { const c = createCanvas(320, 180); const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 320, 180); return c.toBuffer('image/jpeg', 80); };
function imageForm({ bytes = jpeg(), name = 'synthetic.jpg', type = 'image/jpeg', fields = {} } = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ request_id: id(701), expected_version: '1', rights_basis: 'owned', rights_confirmed: 'true', ...fields })) form.append(key, value);
  form.append('file', new Blob([bytes], { type }), name);
  return form;
}
const quarantineEmpty = () => fs.readdirSync(store.quarantine).length === 0;

test('auth boundary: missing/invalid 401, client 403 on every coach route, disabled 503', async () => {
  reset();
  assert.equal((await call('GET', '/capabilities')).status, 401);
  assert.equal((await call('GET', '/capabilities', { token: 'forged' })).status, 401);
  for (const [method, url] of [['GET', '/capabilities'], ['GET', '/library-status'], ['POST', `/exercises/${EX}/drafts`], ['GET', `/revisions/${id(301)}`],
    ['PATCH', `/revisions/${id(301)}/recipe`], ['POST', `/revisions/${id(301)}/process`], ['POST', `/revisions/${id(301)}/review`], ['POST', `/exercises/${EX}/publish`], ['POST', `/revisions/${id(301)}/archive`]]) {
    assert.equal((await call(method, url, { token: 'token-client', body: {} })).status, 403, `${method} ${url}`);
  }
  assert.equal((await call('POST', `/revisions/${id(301)}/sources?role=source_image`, { token: 'token-client', body: imageForm() })).status, 403);
  assert.equal(stageCalls, 0);
  assert.equal(rpcCalls.length, 0);
  enabled = false;
  const off = await call('GET', '/capabilities', { token: 'token-coach-a' });
  assert.equal(off.status, 503); assert.equal(off.body.code, 'media_unavailable');
  assert.equal((await call('GET', '/content/anything')).status, 503);
});

test('uploads: ownership is checked before any byte is accepted; size declared too large is refused early', async () => {
  reset();
  const other = await call('POST', `/revisions/${id(301)}/sources?role=source_image`, { token: 'token-coach-b', body: imageForm() });
  assert.equal(other.status, 404); assert.equal(stageCalls, 0, 'no bytes staged for a non-owner');
  const bad = await call('POST', `/revisions/${id(301)}/sources?role=other`, { token: 'token-coach-a', body: imageForm() });
  assert.equal(bad.status, 400); assert.equal(stageCalls, 0);
  state.revisions[id(301)].status = 'processing';
  assert.equal((await call('POST', `/revisions/${id(301)}/sources?role=source_image`, { token: 'token-coach-a', body: imageForm() })).status, 409);
  state.revisions[id(301)].status = 'draft';
  const big = await fetch(`${base}/revisions/${id(301)}/sources?role=source_image`, { method: 'POST', headers: { authorization: 'Bearer token-coach-a', 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(11 * 1024 * 1024) }, body: 'x'.repeat(10) }).catch(() => null);
  assert.ok(!big || big.status === 413, 'declared oversize refused');
  assert.equal(stageCalls, 0);
});

test('uploads: server actor and server-derived facts only; fake MIME and missing rights refused and discarded', async () => {
  reset();
  state.rpc.exercise_media_attach_source = (args) => {
    state.assets[args.p_asset.id] = { ...args.p_asset, revision_id: id(301), archived: false, uploaded_by_coach_id: args.p_actor };
    return { outcome: 'attached', asset_id: args.p_asset.id, version: 2, replayed: false };
  };
  const ok = await call('POST', `/revisions/${id(301)}/sources?role=source_image`, { token: 'token-coach-a', body: imageForm({ fields: { uploaded_by_coach_id: id(902), status: 'ready', storage_key: '../../x', sha256: 'f'.repeat(64) }, name: '../../evil <script>.jpg', type: 'text/plain' }) });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const args = rpcCalls[0].args;
  assert.equal(args.p_actor, id(901), 'actor from req.user');
  assert.match(args.p_asset.storage_key, /^sources\/[0-9a-f-]{36}\.jpg$/);
  assert.equal(args.p_asset.mime_type, 'image/jpeg', 'MIME from bytes, not the client');
  assert.notEqual(args.p_asset.sha256, 'f'.repeat(64));
  assert.equal(args.p_asset.display_name, 'evil script.jpg');
  assert.ok(fs.existsSync(store.pathFor(args.p_asset.storage_key)), 'committed after the row exists');
  assert.ok(quarantineEmpty());
  assert.equal(JSON.stringify(ok.body).includes('storage_key'), false);
  // Text bytes renamed .jpg with an image MIME: refused from the bytes.
  rpcCalls = [];
  const fake = await call('POST', `/revisions/${id(301)}/sources?role=source_image`, { token: 'token-coach-a', body: imageForm({ bytes: Buffer.from('<svg onload=alert(1)>'), name: 'x.jpg' }) });
  assert.equal(fake.status, 415); assert.equal(fake.body.code, 'unsupported_image_type'); assert.equal(rpcCalls.length, 0); assert.ok(quarantineEmpty());
  const noRights = await call('POST', `/revisions/${id(301)}/sources?role=source_image`, { token: 'token-coach-a', body: imageForm({ fields: { rights_confirmed: 'false' } }) });
  assert.equal(noRights.status, 422); assert.equal(noRights.body.code, 'rights_confirmation_required'); assert.ok(quarantineEmpty());
  // Same request id replayed: the new bytes are discarded, the existing source stays.
  state.rpc.exercise_media_attach_source = () => ({ outcome: 'attached', asset_id: id(777), version: 2, replayed: true });
  const replay = await call('POST', `/revisions/${id(301)}/sources?role=source_image`, { token: 'token-coach-a', body: imageForm() });
  assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true); assert.ok(quarantineEmpty());
  state.rpc.exercise_media_attach_source = () => ({ outcome: 'request_mismatch' });
  assert.equal((await call('POST', `/revisions/${id(301)}/sources?role=source_image`, { token: 'token-coach-a', body: imageForm() })).status, 409);
  assert.ok(quarantineEmpty());
});

test('mutations: forged fields rejected before RPC; CAS and ownership outcomes map to precise statuses', async () => {
  reset();
  assert.equal((await call('PATCH', `/revisions/${id(301)}/recipe`, { token: 'token-coach-a', body: { expected_version: 1, status: 'ready' } })).status, 400);
  assert.equal((await call('PATCH', `/revisions/${id(301)}/recipe`, { token: 'token-coach-a', body: { expected_version: 1, poster_frame_ms: 'NaN' } })).status, 422);
  assert.equal(rpcCalls.length, 0);
  assert.equal((await call('PATCH', `/revisions/${id(301)}/recipe`, { token: 'token-coach-b', body: { expected_version: 1, alt_text: 'x' } })).status, 404);
  state.rpc.exercise_media_publish = (args) => ({ outcome: args.p_actor === id(903) ? 'published' : 'replace_requires_admin', current_version: 2 });
  const refused = await call('POST', `/exercises/${EX}/publish`, { token: 'token-coach-b', body: { revision_id: id(301), expected_current_version: 1, p_actor: id(903) } });
  assert.equal(refused.status, 403); assert.equal(refused.body.code, 'replace_requires_admin');
  assert.equal(rpcCalls.at(-1).args.p_actor, id(902), 'body p_actor ignored');
  assert.equal((await call('POST', `/exercises/${EX}/publish`, { token: 'token-admin', body: { revision_id: id(301), expected_current_version: 1 } })).status, 200);
  state.rpc.exercise_media_publish = () => ({ outcome: 'stale', current_version: 7 });
  const stale = await call('POST', `/exercises/${EX}/publish`, { token: 'token-coach-a', body: { revision_id: id(301), expected_current_version: 1 } });
  assert.equal(stale.status, 409); assert.equal(stale.body.code, 'stale'); assert.equal(stale.body.current_version, 7);
  assert.equal((await call('POST', `/exercises/${EX}/publish`, { token: 'token-coach-a', body: { revision_id: 'x', expected_current_version: 1 } })).status, 400);
  assert.equal((await call('POST', `/exercises/${EX}/drafts`, { token: 'token-coach-a', body: { request_id: id(1), confirm_exercise_id: id(2) } })).status, 400, 'explicit exact-exercise confirmation');
  state.rpc.exercise_media_review = () => ({ outcome: 'attestation_required' });
  assert.equal((await call('POST', `/revisions/${id(301)}/review`, { token: 'token-coach-a', body: { expected_version: 1, variant_confirmed: 'yes' } })).status, 422);
  assert.deepEqual(rpcCalls.at(-1).args.p_attestation, { variant_confirmed: false, rights_confirmed: false, content_confirmed: false }, 'only literal true counts');
});

test('links: authorized per member, bounded, private/no-store, never for another client or a fabricated context', async () => {
  reset();
  const ok = await call('POST', '/links', { token: 'token-client', body: { context: { type: 'workout_log', id: id(501) }, assets: [{ asset_id: id(401) }, { asset_id: id(999) }] } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('cache-control'), 'private, no-store');
  assert.equal(ok.body.links.length, 1); assert.deepEqual(ok.body.missing, [id(999)]);
  assert.match(ok.body.links[0].url, /^\/api\/exercise-media\/content\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(ok.body.links[0].expires_at, new Date(clock + 60_000).toISOString());
  state.log.client_id = id(802);
  assert.equal((await call('POST', '/links', { token: 'token-client', body: { context: { type: 'workout_log', id: id(501) }, assets: [{ asset_id: id(401) }] } })).status, 404);
  assert.equal((await call('POST', '/links', { token: 'token-client', body: { context: { type: 'library', exercise_id: EX }, assets: [{ asset_id: id(401) }] } })).status, 404);
  assert.equal((await call('POST', '/links', { token: 'token-client', body: { context: { type: 'workout_log', id: id(501) }, assets: Array.from({ length: 21 }, (_, i) => ({ asset_id: id(i + 1) })) } })).status, 400);
  assert.equal((await call('POST', '/links', { token: 'token-client', body: { context: { type: 'workout_log', id: 'x' }, assets: [{ asset_id: id(401) }] } })).status, 400);
});

test('content: capability bytes with Range/HEAD; tamper 404, expiry 403, and access re-checked on every request', async () => {
  reset();
  const bytes = Buffer.from(Array.from({ length: 2000 }, (_, i) => i % 251));
  fs.mkdirSync(path.dirname(store.pathFor(state.assets[id(401)].storage_key)), { recursive: true });
  fs.writeFileSync(store.pathFor(state.assets[id(401)].storage_key), bytes);
  const link = (await call('POST', '/links', { token: 'token-client', body: { context: { type: 'workout_log', id: id(501) }, assets: [{ asset_id: id(401) }] } })).body.links[0];
  const url = link.url.replace('/api/exercise-media', '');
  const full = await call('GET', url);
  assert.equal(full.status, 200); assert.deepEqual(full.body, bytes);
  assert.equal(full.headers.get('content-type'), 'image/jpeg');
  assert.equal(full.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.match(full.headers.get('cache-control'), /^private, max-age=\d+$/);
  assert.equal(full.headers.get('content-disposition'), 'inline; filename="exercise-media.jpg"');
  const part = await call('GET', url, { headers: { range: 'bytes=10-19' } });
  assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), 'bytes 10-19/2000'); assert.deepEqual(part.body, bytes.subarray(10, 20));
  assert.equal((await call('GET', url, { headers: { range: 'bytes=5000-' } })).status, 416);
  const head = await fetch(base + url, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), '2000');
  // Tampered and garbage tokens are indistinguishable from missing.
  const [body, mac] = url.replace('/content/', '').split('.');
  assert.equal((await call('GET', `/content/${body}.${mac.slice(0, -2)}AA`)).status, 404);
  assert.equal((await call('GET', '/content/../../etc/passwd')).status, 404);
  // Reassignment (another client now owns the log): the same token stops working.
  state.log.client_id = id(802);
  assert.equal((await call('GET', url)).status, 404);
  state.log.client_id = id(801);
  // Replacement: the asset is no longer the current guide.
  state.current = { revision_id: id(312), version: 2, owner_id: id(901) };
  assert.equal((await call('GET', url)).status, 404);
  state.current = { revision_id: id(311), version: 1, owner_id: id(901) };
  // Archived client profile: the principal no longer resolves.
  users['token-client'].client.archived = true;
  const savedClient = repo.client;
  repo.client = async () => null;
  assert.equal((await call('GET', url)).status, 404);
  repo.client = savedClient; users['token-client'].client.archived = false;
  clock += 61_000;
  const expired = await call('GET', url);
  assert.equal(expired.status, 403); assert.equal(expired.body.code, 'link_expired');
});

test('resolve/text: current guide metadata for an authorized context only', async () => {
  reset();
  const resolved = await call('POST', '/resolve', { token: 'token-client', body: { context: { type: 'workout_log', id: id(501) } } });
  assert.equal(resolved.status, 200); assert.equal(resolved.body.media.length, 1); assert.equal(resolved.body.media[0].poster.asset_id, id(401));
  const text = await call('POST', '/text', { token: 'token-client', body: { context: { type: 'workout_log', id: id(501) }, exercise_id: EX } });
  assert.equal(text.status, 200); assert.equal(text.body.transcript, 'Synthetic transcript');
  assert.equal((await call('POST', '/text', { token: 'token-client', body: { context: { type: 'workout_log', id: id(501) }, exercise_id: id(2) } })).status, 404);
  assert.equal((await call('POST', '/resolve', { token: 'token-client', body: { context: { type: 'revision', id: id(301) } } })).status, 400);
});
