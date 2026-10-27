// Real installed storage-js over synthetic fetch only. No hosted requests or keys.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const { randomUUID, createHash } = require('node:crypto');
const sharp = require('sharp');
const { withStorageRangeValidation } = require('../src/lib/supabaseFetch');
const { SupabaseImageStore, supabaseObjectClient } = require('../src/services/exerciseMedia/supabaseImageStore');
const { ImageOnlyProcessor } = require('../src/services/exerciseMedia/imageProcessor');
const { sniffImage, assertImageFacts } = require('../src/lib/exerciseMedia/validation');
const MiB = 1024 * 1024;

function fixture({ bytes, infoSize = bytes.length, ignoreRange = false, overflow = false, wrongOffset = false, wrongContentRange = false } = {}) {
  const calls = []; let cancelled = false;
  const client = createClient('https://synthetic-project.invalid', 'synthetic-not-a-provider-credential', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: withStorageRangeValidation(async (url, init) => {
      const headers = new Headers(init.headers); const range = headers.get('range');
      calls.push({ url: String(url), range, authorized: headers.has('authorization') && headers.has('apikey') });
      assert.ok(String(url).startsWith('https://synthetic-project.invalid/storage/v1/'));
      if (String(url).includes('/object/info/')) return Response.json({ size: infoSize });
      let result = bytes;
      if (range && !ignoreRange) { const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(range); result = bytes.subarray(Number(start), Number(end) + 1); }
      if (wrongOffset) result = bytes.subarray(0, MiB);
      const body = new ReadableStream({
        start(controller) { controller.enqueue(result); if (overflow) controller.enqueue(Buffer.alloc(1)); else controller.close(); },
        cancel() { cancelled = true; },
      });
      return new Response(body, { status: range && !ignoreRange && !wrongOffset ? 206 : 200, headers: range ? { 'content-range': wrongContentRange ? `bytes 0-${MiB - 1}/${bytes.length}` : `${range.replace('=', ' ')}/${bytes.length}` } : {} });
    }) },
  });
  const store = new SupabaseImageStore({ client: supabaseObjectClient(client, 'exercise-media') });
  return { store, calls, wasCancelled: () => cancelled };
}
const read = async (stream) => { const parts = []; for await (const part of stream) parts.push(part); return Buffer.concat(parts); };

test('installed SDK preserves server auth and sends bounded Range, without reading the whole 10 MiB object', async () => {
  const bytes = Buffer.alloc(10 * MiB, 73); const fake = fixture({ bytes });
  const result = await fake.store.open({ key: `sources/${randomUUID()}.jpg`, range: { start: 5 * MiB, end: 6 * MiB - 1 } });
  assert.deepEqual(await read(result.stream), bytes.subarray(5 * MiB, 6 * MiB));
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.calls[1].range, `bytes=${5 * MiB}-${6 * MiB - 1}`);
  assert.ok(fake.calls.every((call) => call.authorized));
});

test('metadata-first bound, lying metadata, ignored range and overflowing stream all fail closed', async () => {
  const key = `staging/${randomUUID()}`;
  const oversized = fixture({ bytes: Buffer.alloc(10 * MiB + 1) });
  await assert.rejects(oversized.store.readStaged(key, { maxBytes: 10 * MiB }), { code: 'file_too_large' });
  assert.equal(oversized.calls.length, 1);
  const lying = fixture({ bytes: Buffer.alloc(2 * MiB), infoSize: MiB });
  await assert.rejects(lying.store.readStaged(key, { maxBytes: MiB }), { code: 'file_too_large' });
  const ignored = fixture({ bytes: Buffer.alloc(10 * MiB), ignoreRange: true });
  await assert.rejects(ignored.store.open({ key: `sources/${randomUUID()}.jpg`, range: { start: 0, end: MiB - 1 } }), { code: 'storage_unavailable' });
  const overflow = fixture({ bytes: Buffer.alloc(MiB), overflow: true });
  await assert.rejects(overflow.store.readStaged(key, { maxBytes: MiB }), { code: 'file_too_large' });
  assert.equal(overflow.wasCancelled(), true, 'overflowing stream is cancelled rather than retained');
});

test('exact 10 MiB synthetic JPEG can be validated, decoded and cropped through hosted adapter bytes', async () => {
  const jpeg = await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#b0b0b0' } }).jpeg().toBuffer();
  // Deliberate trailing padding exercises the exact byte ceiling, not a real demonstration.
  const bytes = Buffer.concat([jpeg, Buffer.alloc(10 * MiB - jpeg.length)]);
  const fake = fixture({ bytes });
  const source = await fake.store.readStaged(`staging/${randomUUID()}`, { maxBytes: 10 * MiB });
  assert.equal(source.length, 10 * MiB);
  assert.equal(createHash('sha256').update(source).digest('hex'), createHash('sha256').update(bytes).digest('hex'));
  const facts = assertImageFacts(sniffImage(source), source.length);
  const processor = new ImageOnlyProcessor();
  await processor.verifyImage({ buffer: source, facts });
  const poster = await processor.renderImage({ buffer: source, facts, crop: { x: 0, y: 0, width: 1, height: 1 } });
  assert.deepEqual([poster.width, poster.height], [640, 360]);
  assert.ok(poster.bytes <= 160 * 1024);
});


test('provider HTTP200 same-length wrong-offset and HTTP206 wrong Content-Range are refused', async () => {
  for (const options of [{ wrongOffset: true }, { wrongContentRange: true }]) {
    const fake = fixture({ bytes: Buffer.alloc(10 * MiB), ...options });
    await assert.rejects(fake.store.open({ key: `sources/${randomUUID()}.jpg`, range: { start: MiB, end: 2 * MiB - 1 } }), { code: 'storage_unavailable' });
  }
});
