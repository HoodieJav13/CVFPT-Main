// Private photo storage transport contract (docs/exercise-guides/design.md).
// Two adapters satisfy one contract: the working LOCAL filesystem store (with a
// signed loopback PUT grant) and the FUTURE Supabase private-bucket adapter,
// exercised here only through a fake object client that mirrors the documented
// storage-js semantics. No hosted bucket, key or network is touched.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createHash, randomUUID } = require('node:crypto');
const { LocalMediaStore } = require('../src/services/exerciseMedia/localStore');
const { SupabaseImageStore, SIGNED_UPLOAD_TTL_SECONDS, supabaseObjectClient } = require('../src/services/exerciseMedia/supabaseImageStore');
const { MediaError } = require('../src/lib/exerciseMedia/validation');

const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
const SECRET = 'synthetic-local-grant-secret-0123456789abcdef';
const bytes = Buffer.from('synthetic staged image bytes (not decoded here)');
const read = async (stream) => { const parts = []; for await (const part of stream) parts.push(part); return Buffer.concat(parts); };
const rejectsCode = (promise, code) => assert.rejects(promise, (error) => error instanceof MediaError && error.code === code);

function localStore(now = () => Date.now()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cvf-photo-store-'));
  return { root, store: new LocalMediaStore({ root, grantSecret: SECRET, now }) };
}

test('local: an upload grant names only an app-issued staging key and expires', async () => {
  let clock = Date.now();
  const { store } = localStore(() => clock);
  const key = `staging/${randomUUID()}`;
  const grant = store.createUploadGrant({ key, contentType: 'image/jpeg' });
  assert.equal(grant.method, 'PUT');
  assert.match(grant.url, /^\/api\/exercise-media\/staging\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(grant.headers['content-type'], 'image/jpeg');
  assert.equal(grant.max_bytes, 10 * 1024 * 1024);
  assert.ok(Date.parse(grant.expires_at) > clock);
  const token = grant.url.split('/').pop();
  assert.deepEqual(store.verifyUploadGrant(token), { key, contentType: 'image/jpeg', maxBytes: 10 * 1024 * 1024 });
  assert.throws(() => store.verifyUploadGrant(`${token.slice(0, -2)}xx`), (error) => error.code === 'invalid_grant');
  for (const bad of ['sources/x.jpg', 'staging/../objects/sources/a.jpg', 'staging/not-a-uuid', `derivatives/${randomUUID()}/1-poster.jpg`]) {
    assert.throws(() => store.createUploadGrant({ key: bad, contentType: 'image/jpeg' }), (error) => error.code === 'invalid_storage_key', bad);
  }
  clock += 16 * 60 * 1000;
  assert.throws(() => store.verifyUploadGrant(token), (error) => error.code === 'grant_expired');
});

test('local: staged bytes are bounded, idempotent for identical retries and never overwritten', async () => {
  const { store } = localStore();
  const key = `staging/${randomUUID()}`;
  assert.equal(await store.readStaged(key, { maxBytes: 1024 }), null);
  const first = await store.receiveStaged({ key, stream: Readable.from([bytes]), maxBytes: 1024 });
  assert.deepEqual(first, { status: 'stored', bytes: bytes.length, sha256: sha(bytes) });
  const again = await store.receiveStaged({ key, stream: Readable.from([bytes]), maxBytes: 1024 });
  assert.equal(again.status, 'exists');
  await rejectsCode(store.receiveStaged({ key, stream: Readable.from([Buffer.from('different bytes')]), maxBytes: 1024 }), 'staging_conflict');
  assert.deepEqual(await store.readStaged(key, { maxBytes: 1024 }), bytes);
  await rejectsCode(store.readStaged(key, { maxBytes: 4 }), 'file_too_large');
  const big = `staging/${randomUUID()}`;
  await rejectsCode(store.receiveStaged({ key: big, stream: Readable.from([Buffer.alloc(2048)]), maxBytes: 1024 }), 'file_too_large');
  assert.equal(await store.readStaged(big, { maxBytes: 4096 }), null, 'an oversized upload leaves nothing staged');
  // Staging keys are never served through the content path.
  await assert.rejects(store.open({ key, range: null }), (error) => error.code === 'invalid_storage_key');
});

test('local: installing a staged source verifies bytes, keeps the staged copy and never overwrites', async () => {
  const { store } = localStore();
  const id = randomUUID();
  const key = `staging/${id}`;
  await store.receiveStaged({ key, stream: Readable.from([bytes]), maxBytes: 1024 });
  const finalKey = `sources/${id}.jpg`;
  const expected = { bytes: bytes.length, sha256: sha(bytes) };
  assert.deepEqual(await store.installStagedSource(key, finalKey, expected), { installed: true });
  assert.deepEqual(await store.installStagedSource(key, finalKey, expected), { installed: false });
  assert.deepEqual(await read((await store.open({ key: finalKey, range: { start: 0, end: 8 } })).stream), bytes.subarray(0, 9));
  assert.deepEqual(await store.readStaged(key, { maxBytes: 1024 }), bytes, 'no automatic purge of the staged copy');
  await rejectsCode(store.installStagedSource(key, finalKey, { bytes: bytes.length, sha256: 'f'.repeat(64) }), 'stored_source_mismatch');
  const other = `staging/${randomUUID()}`;
  await store.receiveStaged({ key: other, stream: Readable.from([Buffer.from('other')]), maxBytes: 1024 });
  await rejectsCode(store.installStagedSource(other, `sources/${randomUUID()}.jpg`, expected), 'staged_source_mismatch');
});

test('local: derivative objects are bounded writes under server keys and readable back', async () => {
  const { store } = localStore();
  const key = `derivatives/${randomUUID()}/2-poster.jpg`;
  const poster = Buffer.from('synthetic poster');
  assert.deepEqual(await store.putObject({ key, buffer: poster, contentType: 'image/jpeg', maxBytes: 160 * 1024 }), { bytes: poster.length, sha256: sha(poster) });
  assert.deepEqual(await store.readObject(key, { maxBytes: 160 * 1024 }), poster);
  await rejectsCode(store.putObject({ key, buffer: Buffer.alloc(200 * 1024), contentType: 'image/jpeg', maxBytes: 160 * 1024 }), 'output_too_large');
  await assert.rejects(store.putObject({ key: 'derivatives/../../etc/passwd', buffer: poster, contentType: 'image/jpeg', maxBytes: 1024 }), (error) => error.code === 'invalid_storage_key');
  assert.equal(await store.readObject(`sources/${randomUUID()}.jpg`, { maxBytes: 10 }), null);
});

// ----- Future hosted adapter over a fake storage-js-shaped object client -------
function fakeSupabase() {
  const objects = new Map();
  const calls = [];
  const notFound = () => ({ data: null, error: Object.assign(new Error('Object not found'), { statusCode: '404' }) });
  const bucket = {
    async createSignedUploadUrl(objectPath, options) {
      calls.push(['createSignedUploadUrl', objectPath, options]);
      return { data: { signedUrl: `https://synthetic-project.invalid/storage/v1/object/upload/sign/exercise-media-private/${objectPath}?token=SIGNED-UPLOAD-TOKEN`, token: 'SIGNED-UPLOAD-TOKEN', path: objectPath }, error: null };
    },
    async uploadToSignedUrl(objectPath, token, body) { // what the browser PUT does
      if (objects.has(objectPath)) return { data: null, error: Object.assign(new Error('The resource already exists'), { statusCode: '409' }) };
      objects.set(objectPath, Buffer.from(body)); return { data: { path: objectPath }, error: null };
    },
    async download(objectPath) {
      calls.push(['download', objectPath]);
      return objects.has(objectPath) ? { data: new Blob([objects.get(objectPath)]), error: null } : notFound();
    },
    async info(objectPath) { return objects.has(objectPath) ? { data: { size: objects.get(objectPath).length }, error: null } : notFound(); },
    async copy(from, to) {
      calls.push(['copy', from, to]);
      if (!objects.has(from)) return notFound();
      if (objects.has(to)) return { data: null, error: Object.assign(new Error('The resource already exists'), { statusCode: '409' }) };
      objects.set(to, Buffer.from(objects.get(from))); return { data: { path: to }, error: null };
    },
    async upload(objectPath, body, options) {
      calls.push(['upload', objectPath, options]);
      if (objects.has(objectPath) && !options?.upsert) return { data: null, error: Object.assign(new Error('The resource already exists'), { statusCode: '409' }) };
      objects.set(objectPath, Buffer.from(body)); return { data: { path: objectPath }, error: null };
    },
  };
  const supabase = { storage: { from(name) { calls.push(['from', name]); return bucket; } } };
  return { supabase, bucket, objects, calls };
}

test('hosted adapter: grants use the provider signed upload (documented 2 h) for staging keys only, no overwrite', async () => {
  assert.equal(SIGNED_UPLOAD_TTL_SECONDS, 2 * 60 * 60, 'provider-documented signed upload lifetime, not the 60 s read capability');
  const fake = fakeSupabase();
  const now = Date.parse('2031-01-01T00:00:00Z');
  const store = new SupabaseImageStore({ client: supabaseObjectClient(fake.supabase, 'exercise-media-private'), now: () => now });
  const key = `staging/${randomUUID()}`;
  const grant = await store.createUploadGrant({ key, contentType: 'image/webp' });
  assert.equal(grant.method, 'PUT');
  assert.match(grant.url, /^https:\/\/synthetic-project\.invalid\/storage\/v1\/object\/upload\/sign\//);
  assert.equal(grant.headers['content-type'], 'image/webp');
  assert.equal(grant.headers['x-upsert'], 'false');
  assert.equal(grant.expires_at, new Date(now + 7200 * 1000).toISOString());
  assert.deepEqual(fake.calls.find((call) => call[0] === 'createSignedUploadUrl'), ['createSignedUploadUrl', key, { upsert: false }]);
  assert.equal(JSON.stringify(grant).includes('service'), false, 'no service credential in a grant');
  await assert.rejects(store.createUploadGrant({ key: 'sources/a.jpg', contentType: 'image/jpeg' }), (error) => error.code === 'invalid_storage_key');
});

test('hosted adapter: finalize reads bounded staged bytes, copies to the immutable source key and verifies it', async () => {
  const fake = fakeSupabase();
  const store = new SupabaseImageStore({ client: supabaseObjectClient(fake.supabase, 'exercise-media-private') });
  const id = randomUUID();
  const key = `staging/${id}`;
  assert.equal(await store.readStaged(key, { maxBytes: 1024 }), null, 'not uploaded yet');
  await fake.bucket.uploadToSignedUrl(key, 'SIGNED-UPLOAD-TOKEN', bytes);
  assert.deepEqual(await store.readStaged(key, { maxBytes: 1024 }), bytes);
  await rejectsCode(store.readStaged(key, { maxBytes: 4 }), 'file_too_large');
  const expected = { bytes: bytes.length, sha256: sha(bytes) };
  const finalKey = `sources/${id}.jpg`;
  assert.deepEqual(await store.installStagedSource(key, finalKey, expected), { installed: true });
  // A double finalize finds the copy already present and verifies it.
  assert.deepEqual(await store.installStagedSource(key, finalKey, expected), { installed: false });
  assert.ok(fake.objects.has(key), 'the staged object is kept (no purge policy)');
  await rejectsCode(store.installStagedSource(key, finalKey, { ...expected, sha256: 'e'.repeat(64) }), 'stored_source_mismatch');
  assert.deepEqual(await read((await store.open({ key: finalKey, range: { start: 2, end: 5 } })).stream), bytes.subarray(2, 6));
  assert.deepEqual(await store.stat(finalKey), { size: bytes.length });
});

test('hosted adapter: derivatives are server-keyed uploads; reads are streamed through the app, never redirected', async () => {
  const fake = fakeSupabase();
  const store = new SupabaseImageStore({ client: supabaseObjectClient(fake.supabase, 'exercise-media-private') });
  const key = `derivatives/${randomUUID()}/3-poster.jpg`;
  const poster = Buffer.from('synthetic poster bytes');
  assert.deepEqual(await store.putObject({ key, buffer: poster, contentType: 'image/jpeg', maxBytes: 160 * 1024 }), { bytes: poster.length, sha256: sha(poster) });
  assert.deepEqual(fake.calls.find((call) => call[0] === 'upload').slice(1), [key, { contentType: 'image/jpeg', upsert: true, cacheControl: 'no-store' }]);
  const opened = await store.open({ key, range: null });
  assert.equal(opened.size, poster.length);
  assert.deepEqual(await read(opened.stream), poster);
  assert.equal('url' in opened, false, 'no signed object URL is handed to the browser');
  await rejectsCode(store.putObject({ key, buffer: Buffer.alloc(200 * 1024), contentType: 'image/jpeg', maxBytes: 160 * 1024 }), 'output_too_large');
  await assert.rejects(store.open({ key: `derivatives/${randomUUID()}/1-poster.jpg`, range: null }), (error) => error.code === 'not_found');
});

test('hosted adapter: provider failures map to safe retryable codes without leaking URLs or tokens', async () => {
  const failing = { storage: { from: () => ({
    async createSignedUploadUrl() { return { data: null, error: new Error('upstream 500 https://synthetic-project.invalid?token=SECRET') }; },
    async download() { return { data: null, error: Object.assign(new Error('upstream 503 token=SECRET'), { statusCode: '503' }) }; },
  }) } };
  const store = new SupabaseImageStore({ client: supabaseObjectClient(failing, 'exercise-media-private') });
  await assert.rejects(store.createUploadGrant({ key: `staging/${randomUUID()}`, contentType: 'image/jpeg' }), (error) => error.code === 'storage_unavailable' && error.status === 503 && !/SECRET|token/.test(error.message));
  await assert.rejects(store.readStaged(`staging/${randomUUID()}`, { maxBytes: 10 }), (error) => error.code === 'storage_unavailable' && !/SECRET/.test(error.message));
});
