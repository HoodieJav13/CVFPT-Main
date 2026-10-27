import test from 'node:test';
import assert from 'node:assert/strict';
import * as sources from '../../src/lib/exerciseMediaSource.js';

const MiB = 1024 * 1024;
function transport(bytes, { revokeAt = Infinity, ignoredRange = false, badRange = false, extra = false } = {}) {
  const calls = [];
  return { calls, fetcher: async (_url, options) => {
    calls.push(options);
    if (calls.length >= revokeAt) return new Response(null, { status: 404 });
    if (options.method === 'HEAD') return new Response(null, { headers: { 'content-length': bytes.length, 'content-type': 'image/jpeg' } });
    const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range).map(Number);
    const data = bytes.subarray(start, end + 1);
    return new Response(extra ? Buffer.concat([data, Buffer.from([0])]) : data, { status: ignoredRange ? 200 : 206, headers: {
      'content-range': badRange ? 'bytes 0-1/2' : `bytes ${start}-${end}/${bytes.length}`, 'content-type': 'image/jpeg',
    } });
  } };
}
test('10 MiB source reconstructs exactly through ten sequential bounded ranges', async () => {
  const bytes = Buffer.alloc(10 * MiB, 31); const fake = transport(bytes);
  const blob = await sources.readSourceImage('https://api.example.invalid/content/test', { fetcher: fake.fetcher });
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), bytes);
  assert.equal(fake.calls.length, 11); assert.equal(blob.type, 'image/jpeg');
  assert.equal(fake.calls[0].method, 'HEAD');
  assert.ok(fake.calls.every((call) => call.cache === 'no-store' && call.credentials === 'omit' && call.redirect === 'error'));
});
test('revocation, incorrect ranges, ignored ranges and oversized bodies fail without a partial photo', async () => {
  for (const options of [{ revokeAt: 3 }, { ignoredRange: true }, { badRange: true }, { extra: true }]) {
    const fake = transport(Buffer.alloc(2 * MiB), options);
    await assert.rejects(sources.readSourceImage('https://api.example.invalid/content/test', { fetcher: fake.fetcher }));
    assert.ok(fake.calls.length <= 3);
  }
});
test('oversized metadata stops before any source bytes are fetched', async () => {
  const fake = transport(Buffer.alloc(10 * MiB + 1));
  await assert.rejects(sources.readSourceImage('https://api.example.invalid/content/test', { fetcher: fake.fetcher }));
  assert.equal(fake.calls.length, 1);
});
