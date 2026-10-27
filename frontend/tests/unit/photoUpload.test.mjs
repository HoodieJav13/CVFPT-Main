// Browser half of the photo direct-upload transport (docs/exercise-guides/design.md):
// the app API issues a durable intent + grant, the browser PUTs the bytes to the
// grant target (the app's loopback staging route locally, a provider signed URL
// when hosted), then asks the API to finalize. The app bearer token never goes
// to a provider; retries reuse the same request id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { providerUploadHeaders, stagingUploadTarget, uploadPhotoSource } from '../../src/lib/exerciseMedia.js';

test('grant targets: app staging paths go through the API client; only HTTPS provider URLs are accepted', () => {
  assert.deepEqual(stagingUploadTarget({ url: '/api/exercise-media/staging/abc.def' }), { kind: 'api', path: '/exercise-media/staging/abc.def' });
  assert.deepEqual(stagingUploadTarget({ url: 'https://synthetic-project.invalid/storage/v1/object/upload/sign/bucket/staging/x?token=t' }),
    { kind: 'provider', url: 'https://synthetic-project.invalid/storage/v1/object/upload/sign/bucket/staging/x?token=t' });
  for (const url of ['http://synthetic-project.invalid/upload', 'javascript:alert(1)', '/api/other/route', '//evil.example/x', 'https://user:pw@host.invalid/x', '', null]) {
    assert.equal(stagingUploadTarget({ url }), null, String(url));
  }
});

test('provider PUT headers are an allowlist: never the app Authorization header', () => {
  assert.deepEqual(providerUploadHeaders({ headers: { 'content-type': 'image/jpeg', 'x-upsert': 'false', authorization: 'Bearer app-token', cookie: 'x' } }),
    { 'content-type': 'image/jpeg', 'x-upsert': 'false' });
});

function fakeApi(script) {
  const calls = [];
  const respond = async (method, url, body) => {
    calls.push([method, url, body]);
    const next = script.shift();
    if (!next) throw new Error(`unexpected ${method} ${url}`);
    if (next.error) throw next.error;
    return { data: next.data };
  };
  return { calls, post: (url, body) => respond('post', url, body), put: (url, body) => respond('put', url, body) };
}
const httpError = (status, code) => Object.assign(new Error(code), { response: { status, data: { code } } });
const file = { name: 'synthetic.jpg', size: 1234, type: 'image/jpeg' };
const revision = { id: 'rev-1', version: 3 };

test('issue -> PUT -> finalize, with the request id, declared size and rights the coach confirmed', async () => {
  const api = fakeApi([
    { data: { intent: { id: 'intent-1', state: 'issued' }, upload: { method: 'PUT', url: '/api/exercise-media/staging/g.s', headers: { 'content-type': 'image/jpeg' } } } },
    { data: { status: 'stored' } },
    { data: { revision: { id: 'rev-1', version: 4 }, replayed: false } },
  ]);
  const result = await uploadPhotoSource({ apiClient: api, revision, file, rights: 'owned', note: ' synthetic note ', requestId: 'req-1' });
  assert.deepEqual(result, { revision: { id: 'rev-1', version: 4 }, replayed: false, intentId: 'intent-1' });
  assert.deepEqual(api.calls[0], ['post', '/exercise-media/revisions/rev-1/uploads', { request_id: 'req-1', role: 'source_image', bytes: 1234, mime_type: 'image/jpeg', expected_version: 3, rights_confirmed: true }]);
  assert.equal(api.calls[1][0], 'put');
  assert.equal(api.calls[1][1], '/exercise-media/staging/g.s');
  assert.equal(api.calls[1][2], file);
  assert.deepEqual(api.calls[2], ['post', '/exercise-media/revisions/rev-1/uploads/intent-1/finalize', { expected_version: 3, rights_basis: 'owned', rights_confirmed: 'true', rights_note: 'synthetic note', original_name: 'synthetic.jpg' }]);
});

test('an already-stored retry PUT proceeds to finalize; a provider target is sent without app credentials', async () => {
  const api = fakeApi([
    { data: { intent: { id: 'intent-2', state: 'issued' }, upload: { method: 'PUT', url: 'https://synthetic-project.invalid/sign/x?token=t', headers: { 'content-type': 'image/jpeg', 'x-upsert': 'false' } } } },
    { data: { revision: { id: 'rev-1', version: 5 }, replayed: true } },
  ]);
  const provider = [];
  const result = await uploadPhotoSource({
    apiClient: api, revision, file, rights: 'permissioned', note: '', requestId: 'req-2',
    sendToProvider: async (url, body, headers) => { provider.push([url, body, headers]); throw httpError(409, 'already_exists'); },
  });
  assert.equal(result.replayed, true);
  assert.deepEqual(provider, [['https://synthetic-project.invalid/sign/x?token=t', file, { 'content-type': 'image/jpeg', 'x-upsert': 'false' }]]);
  assert.equal(api.calls.some(([method]) => method === 'put'), false, 'the app API client never PUTs to a provider');
});

test('an already-attached intent skips the transfer; an unusable grant fails before any bytes move', async () => {
  const done = fakeApi([
    { data: { intent: { id: 'intent-3', state: 'attached' }, upload: null } },
    { data: { revision: { id: 'rev-1', version: 6 }, replayed: true } },
  ]);
  assert.equal((await uploadPhotoSource({ apiClient: done, revision, file, rights: 'owned', note: '', requestId: 'req-3' })).replayed, true);
  assert.equal(done.calls.length, 2);
  const bad = fakeApi([{ data: { intent: { id: 'intent-4', state: 'issued' }, upload: { method: 'PUT', url: 'javascript:alert(1)', headers: {} } } }]);
  await assert.rejects(uploadPhotoSource({ apiClient: bad, revision, file, rights: 'owned', note: '', requestId: 'req-4' }), /upload target/);
  assert.equal(bad.calls.length, 1);
});

test('a file with no browser-reported type declares the type its extension implies (the server still sniffs)', async () => {
  const api = fakeApi([
    { data: { intent: { id: 'intent-5', state: 'issued' }, upload: { method: 'PUT', url: '/api/exercise-media/staging/g.s', headers: { 'content-type': 'image/webp' } } } },
    { data: { status: 'stored' } },
    { data: { revision: { id: 'rev-1', version: 4 }, replayed: false } },
  ]);
  await uploadPhotoSource({ apiClient: api, revision, file: { name: 'SYNTHETIC.WEBP', size: 10, type: '' }, rights: 'owned', note: '', requestId: 'req-5' });
  assert.equal(api.calls[0][2].mime_type, 'image/webp');
});
