// Image-only exercise-media processor (docs/exercise-guides/design.md): the
// default photo pipeline with a pinned in-process decoder and NO FFmpeg/Docker
// worker. Real synthetic bytes (geometric shapes + a SYNTHETIC label; no people,
// no instruction) through authoritative sniff -> full decode -> normalized
// 640x360 JPEG poster; plus bounded concurrency/queue/deadline behavior.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas } = require('@napi-rs/canvas');
const sharp = require('sharp');
const { ImageOnlyProcessor, PHOTO_LIMITS } = require('../src/services/exerciseMedia/imageProcessor');
const { sniffImage, assertImageFacts, MediaError, LIMITS } = require('../src/lib/exerciseMedia/validation');

function frame(width, height, { top = '#c0392b', bottom = '#2471a3' } = {}) {
  const canvas = createCanvas(width, height);
  const g = canvas.getContext('2d');
  g.fillStyle = top; g.fillRect(0, 0, width, height / 2);
  g.fillStyle = bottom; g.fillRect(0, height / 2, width, height / 2);
  g.fillStyle = '#ffffff'; g.font = `bold ${Math.max(12, Math.round(width / 40))}px Helvetica`;
  g.fillText('SYNTHETIC TEST MEDIA - NOT INSTRUCTION', 10, height / 2);
  return canvas;
}

// Stored landscape, EXIF orientation 6 (display portrait, red on top) + a GPS pointer.
function exifJpeg(storedWidth, storedHeight) {
  const canvas = createCanvas(storedWidth, storedHeight);
  const g = canvas.getContext('2d');
  g.fillStyle = '#c0392b'; g.fillRect(0, 0, storedWidth / 2, storedHeight);
  g.fillStyle = '#2471a3'; g.fillRect(storedWidth / 2, 0, storedWidth / 2, storedHeight);
  const jpeg = canvas.toBuffer('image/jpeg', 85);
  const entries = [[0x0112, 3, 1, 6 << 16], [0x8825, 4, 1, 38]];
  const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
  const ifd = Buffer.concat([u16(entries.length), ...entries.map(([t, ty, c, v]) => Buffer.concat([u16(t), u16(ty), u32(c), u32(v)])), u32(0)]);
  const gpsIfd = Buffer.concat([u16(1), u16(0x0001), u16(2), u32(2), Buffer.from('N\0\0\0'), u32(0)]);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), Buffer.from('MM'), u16(42), u32(8), ifd, gpsIfd]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), u16(payload.length + 2), payload]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

const processor = new ImageOnlyProcessor();
const FULL = { x: 0, y: 0, width: 1, height: 1 };
const facts = (buffer) => assertImageFacts(sniffImage(buffer), buffer.length);
const rejectsWith = (promise, code) => assert.rejects(promise, (error) => error instanceof MediaError && error.code === code);

test('photo limits are the existing acceptance limits, not new product quotas', () => {
  assert.equal(PHOTO_LIMITS.maxInputPixels, LIMITS.image.maxPixels);
  assert.equal(PHOTO_LIMITS.maxBytes, LIMITS.image.maxBytes);
  assert.equal(PHOTO_LIMITS.poster.width, 640);
  assert.equal(PHOTO_LIMITS.poster.height, 360);
  assert.equal(PHOTO_LIMITS.poster.maxBytes, 160 * 1024);
  assert.equal(PHOTO_LIMITS.concurrency, 1);
  assert.equal(PHOTO_LIMITS.maxQueue, 4);
  assert.equal(PHOTO_LIMITS.decodeTimeoutMs, 10_000);
  assert.equal(PHOTO_LIMITS.totalTimeoutMs, 15_000);
  assert.match(processor.version, /^sharp 0\.35\.5 \/ libvips \d+\.\d+\.\d+/);
});

test('JPEG/PNG/WebP: full decode, oriented crop, sRGB 640x360 JPEG poster within budget, metadata stripped', async () => {
  const exif = exifJpeg(1920, 1080);
  const f = facts(exif);
  assert.deepEqual([f.width, f.height, f.orientation, f.hasGps], [1080, 1920, 6, true]);
  await processor.verifyImage({ buffer: exif, facts: f });
  // Top band of the DISPLAYED portrait, in oriented normalized coordinates.
  const poster = await processor.renderImage({ buffer: exif, facts: f, crop: { x: 0, y: 0, width: 1, height: (1080 * 9 / 16) / 1920 } });
  assert.deepEqual([poster.width, poster.height, poster.mime_type], [640, 360, 'image/jpeg']);
  assert.ok(poster.bytes <= 160 * 1024 && poster.bytes === poster.buffer.length);
  assert.match(poster.sha256, /^[0-9a-f]{64}$/);
  const meta = await sharp(poster.buffer).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.exif, undefined, 'no EXIF in the derivative');
  assert.equal(meta.icc, undefined, 'no embedded profile');
  assert.equal(meta.orientation, undefined);
  assert.equal(poster.buffer.indexOf(Buffer.from('GPS')), -1);
  const { data } = await sharp(poster.buffer).raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => [...data.subarray((y * 640 + x) * 3, (y * 640 + x) * 3 + 3)];
  const [r, , b] = at(320, 180);
  assert.ok(r > 150 && b < 100, `oriented top band should be red, got ${at(320, 180)}`);

  for (const mime of ['image/png', 'image/webp']) {
    const buffer = frame(1280, 720).toBuffer(mime);
    const image = facts(buffer);
    await processor.verifyImage({ buffer, facts: image });
    const out = await processor.renderImage({ buffer, facts: image, crop: FULL });
    assert.deepEqual([out.width, out.height], [640, 360], mime);
  }
});

test('a typical photo poster lands near the practical ~80KB target', async () => {
  const canvas = createCanvas(3024, 4032);
  const g = canvas.getContext('2d');
  for (let i = 0; i < 400; i += 1) {
    g.fillStyle = `hsl(${(i * 37) % 360}, 55%, ${30 + (i % 40)}%)`;
    g.fillRect((i * 97) % 3024, (i * 61) % 4032, 180, 140);
  }
  const buffer = canvas.toBuffer('image/jpeg', 88);
  const f = facts(buffer);
  const crop = { x: 0, y: 0.2, width: 1, height: (3024 * 9 / 16) / 4032 };
  const started = Date.now();
  const out = await processor.renderImage({ buffer, facts: f, crop });
  assert.ok(out.bytes <= 160 * 1024, `${out.bytes} bytes`);
  assert.ok(Date.now() - started < 10_000);
});

test('forged, corrupt and abusive inputs never reach a derivative', async () => {
  const good = frame(1280, 720).toBuffer('image/jpeg', 90);
  // Truncated entropy data: full decode with strict warnings refuses it.
  const truncated = good.subarray(0, Math.floor(good.length / 3));
  await rejectsWith(processor.verifyImage({ buffer: truncated, facts: sniffImage(truncated) }), 'corrupt_image');
  // Header facts that disagree with the decoded frame.
  await rejectsWith(processor.verifyImage({ buffer: good, facts: { ...sniffImage(good), width: 999 } }), 'corrupt_image');
  // A declared format that is not what the bytes decode as.
  const png = frame(320, 180).toBuffer('image/png');
  await rejectsWith(processor.verifyImage({ buffer: png, facts: { ...sniffImage(png), format: 'jpeg' } }), 'corrupt_image');
  // Polyglot: a valid JPEG with an HTML/script tail is accepted only as the
  // decoded pixels; the tail never survives into the derivative.
  const polyglot = Buffer.concat([good, Buffer.from('<html><script>alert(1)</script></html>')]);
  const out = await processor.renderImage({ buffer: polyglot, facts: sniffImage(polyglot), crop: FULL });
  assert.equal(out.buffer.indexOf(Buffer.from('<script>')), -1);
  // SVG / HTML / empty bytes never pass the byte sniff.
  for (const bytes of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), Buffer.from('<!doctype html><p>x</p>'), Buffer.alloc(0)]) {
    assert.throws(() => sniffImage(bytes), (error) => error instanceof MediaError);
  }
});

test('animated or multi-page images are refused even if a header flag is missing', async () => {
  const one = await sharp({ create: { width: 320, height: 180, channels: 3, background: '#c0392b' } }).webp().toBuffer();
  const two = await sharp({ create: { width: 320, height: 180, channels: 3, background: '#2471a3' } }).webp().toBuffer();
  const animated = await sharp([one, two], { join: { animated: true } }).webp({ loop: 0 }).toBuffer();
  const sniffed = sniffImage(animated);
  assert.equal(sniffed.animated, true, 'byte sniff already flags animation');
  // Even when the caller-supplied facts claim a still image, decode refuses it.
  await rejectsWith(processor.verifyImage({ buffer: animated, facts: { ...sniffed, animated: false } }), 'animated_image_not_supported');
});

test('pixel and byte bounds are enforced before and during decode', async () => {
  // A header-declared pixel bomb fails the existing facts check before decoding.
  const bomb = Buffer.from(frame(200, 200).toBuffer('image/png'));
  bomb.writeUInt32BE(8000, 16); bomb.writeUInt32BE(8000, 20);
  assert.throws(() => assertImageFacts(sniffImage(bomb), bomb.length), (error) => error.code === 'image_too_many_pixels');
  // The decoder's own input-pixel limit is the same ceiling (never unlimited).
  await rejectsWith(processor.verifyImage({ buffer: bomb, facts: { ...sniffImage(bomb), width: 200, height: 200 } }), 'corrupt_image');
  await rejectsWith(processor.verifyImage({ buffer: Buffer.alloc(LIMITS.image.maxBytes + 1, 0xff), facts: { format: 'jpeg', width: 200, height: 200, orientation: 1 } }), 'file_too_large');
});

test('16-bit and wide-gamut sources normalize to an 8-bit sRGB poster', async () => {
  const deep = await sharp({ create: { width: 640, height: 360, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    .png({ bitdepth: 16 }).toColourspace('rgb16').toBuffer();
  const out = await processor.renderImage({ buffer: deep, facts: facts(deep), crop: FULL });
  const meta = await sharp(out.buffer).metadata();
  assert.equal(meta.depth, 'uchar');
  assert.equal(meta.space, 'srgb');
  const p3 = await sharp({ create: { width: 640, height: 360, channels: 3, background: '#2e8b57' } }).withIccProfile('p3').jpeg().toBuffer();
  assert.ok((await sharp(p3).metadata()).icc, 'fixture carries a P3 profile');
  const normalized = await sharp((await processor.renderImage({ buffer: p3, facts: facts(p3), crop: FULL })).buffer).metadata();
  assert.equal(normalized.icc, undefined);
  assert.equal(normalized.space, 'srgb');
});

test('crop must match the oriented source and stay 16:9; required output is never silently weakened', async () => {
  const buffer = frame(1280, 720).toBuffer('image/jpeg', 90);
  const f = facts(buffer);
  await rejectsWith(processor.renderImage({ buffer, facts: f, crop: { x: 0, y: 0, width: 0.5, height: 1 } }), 'crop_aspect_mismatch');
  await rejectsWith(processor.renderImage({ buffer, facts: f, crop: { x: 0.9, y: 0, width: 0.5, height: 0.5 } }), 'invalid_crop');
  // A budget that cannot be met fails usefully rather than shipping a bigger poster.
  const tight = new ImageOnlyProcessor({ posterMaxBytes: 1024 });
  const noisy = createCanvas(1600, 900);
  const g = noisy.getContext('2d');
  for (let i = 0; i < 5000; i += 1) { g.fillStyle = `hsl(${(i * 53) % 360}, 80%, 50%)`; g.fillRect((i * 31) % 1600, (i * 17) % 900, 7, 7); }
  const busy = noisy.toBuffer('image/png');
  await rejectsWith(tight.renderImage({ buffer: busy, facts: facts(busy), crop: FULL }), 'poster_too_large');
});

test('one decode at a time, a bounded waiting queue and hard deadlines (injected tasks)', async () => {
  let active = 0; let peak = 0;
  const release = [];
  const slow = () => new Promise((resolve) => {
    active += 1; peak = Math.max(peak, active);
    release.push(() => { active -= 1; resolve('ok'); });
  });
  const waitUntil = async (ready) => { for (let i = 0; i < 1000 && !ready(); i += 1) await new Promise((resolve) => setImmediate(resolve)); assert.ok(ready()); };
  const bounded = new ImageOnlyProcessor({ decodeTimeoutMs: 10_000, totalTimeoutMs: 15_000 });
  const jobs = Array.from({ length: 5 }, () => bounded.schedule(slow));
  // 1 running + 4 waiting is the bound; the 6th is refused as retryable busy.
  await rejectsWith(bounded.schedule(slow), 'processor_busy');
  for (let n = 0; n < 5; n += 1) {
    await waitUntil(() => release.length > n);
    assert.equal(active, 1, 'exactly one task runs');
    release[n]();
  }
  assert.deepEqual(await Promise.all(jobs), ['ok', 'ok', 'ok', 'ok', 'ok']);
  assert.equal(peak, 1, 'never more than one decode per instance');

  const hung = new ImageOnlyProcessor({ decodeTimeoutMs: 30, totalTimeoutMs: 60 });
  await rejectsWith(hung.schedule(() => new Promise(() => {})), 'processor_timeout');
  // The total deadline covers waiting AND processing. A timed-out decode keeps
  // its slot until it really settles, so nothing overlaps it.
  const waits = new ImageOnlyProcessor({ decodeTimeoutMs: 1000, totalTimeoutMs: 60 });
  let releaseBlocker;
  const blocker = waits.schedule(() => new Promise((resolve) => { releaseBlocker = () => resolve('done'); }));
  const waiter = waits.schedule(() => Promise.resolve('late'));
  await Promise.all([rejectsWith(blocker, 'processor_timeout'), rejectsWith(waiter, 'processor_timeout')]);
  let started = false;
  const after = waits.schedule(() => { started = true; return Promise.resolve('ran'); });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(started, false, 'the timed-out decode still holds the only slot');
  releaseBlocker();
  assert.equal(await after, 'ran');
  assert.equal(started, true);
  assert.equal(new MediaError('processor_busy').status, 503);
  assert.equal(new MediaError('processor_timeout').status, 503);
});

test('video work is not available in photos mode', async () => {
  for (const method of ['probe', 'renderVideo', 'renderFramePreview']) {
    await rejectsWith(processor[method]({}), 'video_processing_unavailable');
  }
});
