// Real bytes through the real store and the pinned FFmpeg/FFprobe processor.
// Requires Docker plus the task-built processor image (scripts/exercise-media/
// ffmpeg.Dockerfile). When either is missing the processor tests SKIP with the
// reason; they never report a fake success. The store tests always run.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');
const { createCanvas } = require('@napi-rs/canvas');
const { LocalMediaStore } = require('../src/services/exerciseMedia/localStore');
const { createCapabilitySigner } = require('../src/services/exerciseMedia/capabilities');
const { FfmpegMediaProcessor, DockerToolRunner, PROCESSOR_IMAGE, processorAvailable } = require('../src/services/exerciseMedia/ffmpegProcessor');
const { sniffImage, sniffVideoContainer, MediaError } = require('../src/lib/exerciseMedia/validation');

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `cvf-media-${name}-`));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

function syntheticFrame(width, height, { top = '#c0392b', bottom = '#2471a3', label = 'SYNTHETIC TEST MEDIA - NOT INSTRUCTION' } = {}) {
  const canvas = createCanvas(width, height);
  const g = canvas.getContext('2d');
  g.fillStyle = top; g.fillRect(0, 0, width, height / 2);
  g.fillStyle = bottom; g.fillRect(0, height / 2, width, height / 2);
  g.fillStyle = '#ffffff'; g.font = `bold ${Math.max(12, Math.round(width / 40))}px Helvetica`;
  g.fillText(label, 10, height / 2);
  return canvas;
}

// JPEG whose stored pixels are landscape but EXIF says "rotate 90 CW" (6),
// plus a GPS pointer that must never reach a derivative.
function exifJpeg(storedWidth, storedHeight) {
  // Displayed portrait: red on top. Stored = displayed rotated 90 CCW, so red sits on the LEFT.
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

async function streamToBuffer(stream) { const parts = []; for await (const part of stream) parts.push(part); return Buffer.concat(parts); }

// ----- Store (always runs) ---------------------------------------------------
test('store: atomic put, hash, containment, bounded size, ranges and sweeps', async () => {
  const root = tmp('store');
  const store = new LocalMediaStore({ root });
  const key = 'sources/e0000000-0000-4000-8000-0000000000f1.jpg';
  const body = Buffer.from('synthetic bytes for the store');
  const put = await store.put({ key, stream: Readable.from([body]), maxBytes: 1024 });
  assert.deepEqual(put, { bytes: body.length, sha256: sha(body) });
  const opened = await store.open({ key, range: { start: 10, end: 14 } });
  assert.equal(opened.size, body.length);
  assert.equal((await streamToBuffer(opened.stream)).toString(), body.subarray(10, 15).toString());
  // Keys are server-generated shapes only.
  for (const bad of ['../x', 'sources/../../etc/passwd', '/etc/passwd', 'sources/not-a-uuid.jpg', 'derivatives/x/1-poster.jpg', 'sources/e0000000-0000-4000-8000-0000000000f1.svg']) {
    await assert.rejects(store.open({ key: bad }), /invalid_storage_key/, bad);
  }
  // Oversized streams abort without leaving a partial object.
  const big = 'sources/e0000000-0000-4000-8000-0000000000f2.mp4';
  await assert.rejects(store.put({ key: big, stream: Readable.from([Buffer.alloc(600), Buffer.alloc(600)]), maxBytes: 1000 }), (e) => e instanceof MediaError && e.code === 'file_too_large');
  await assert.rejects(store.open({ key: big }), /not_found/);
  assert.deepEqual(fs.readdirSync(path.join(root, 'quarantine')), []);
  // A symlink planted at an object path is refused, not followed.
  const linkKey = 'sources/e0000000-0000-4000-8000-0000000000f3.png';
  fs.mkdirSync(path.dirname(store.pathFor(linkKey)), { recursive: true });
  fs.symlinkSync('/etc/hosts', store.pathFor(linkKey));
  await assert.rejects(store.open({ key: linkKey }), /not_found|symlink/);
  // Staged uploads: commit renames, discard removes; the sweep removes only
  // expired quarantine/work entries and never committed objects.
  const staged = await store.stageUpload({ stream: Readable.from([body]), maxBytes: 1024 });
  assert.equal(staged.bytes, body.length);
  assert.ok(fs.existsSync(staged.path));
  await store.commitUpload(staged.uploadId, 'sources/' + staged.uploadId + '.jpg');
  assert.ok(fs.existsSync(store.pathFor('sources/' + staged.uploadId + '.jpg')));
  const stale = await store.stageUpload({ stream: Readable.from([body]), maxBytes: 1024 });
  const old = new Date(Date.now() - 2 * 3600 * 1000);
  fs.utimesSync(stale.path, old, old);
  const work = store.workDir('job-sweep-test');
  fs.writeFileSync(path.join(work, 'partial.mp4'), 'x');
  fs.utimesSync(work, old, old);
  const swept = await store.removeTemporary({ olderThanMs: 3600 * 1000 });
  assert.equal(swept.quarantine, 1); assert.equal(swept.work, 1);
  assert.ok(!fs.existsSync(stale.path)); assert.ok(!fs.existsSync(work));
  assert.ok(fs.existsSync(store.pathFor(key)), 'committed objects are never swept');
});

test('capabilities: signed, expiring, tamper-evident, never durable', () => {
  let now = 1_800_000_000_000;
  const signer = createCapabilitySigner({ secret: 'x'.repeat(48), now: () => now });
  const token = signer.issue({ assetId: 'e0000000-0000-4000-8000-0000000000a1', revisionId: 'e0000000-0000-4000-8000-0000000000a2', principal: { kind: 'client', id: 'e0000000-0000-4000-8000-0000000000a3' }, context: { type: 'workout_log', id: 'e0000000-0000-4000-8000-0000000000a4' }, ttlSeconds: 60 });
  assert.match(token.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(token.expiresAt, new Date(now + 60_000).toISOString());
  const verified = signer.verify(token.token);
  assert.equal(verified.ok, true); assert.equal(verified.payload.a, 'e0000000-0000-4000-8000-0000000000a1');
  const [body, mac] = token.token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), a: 'e0000000-0000-4000-8000-0000000000ff' })).toString('base64url');
  assert.deepEqual(signer.verify(`${forged}.${mac}`), { ok: false, reason: 'invalid' });
  assert.deepEqual(signer.verify('garbage'), { ok: false, reason: 'invalid' });
  assert.deepEqual(createCapabilitySigner({ secret: 'y'.repeat(48), now: () => now }).verify(token.token), { ok: false, reason: 'invalid' });
  now += 61_000;
  assert.deepEqual(signer.verify(token.token), { ok: false, reason: 'expired' });
  assert.throws(() => createCapabilitySigner({ secret: 'short' }), /secret/);
  assert.throws(() => signer.issue({ assetId: 'x', revisionId: 'y', principal: { kind: 'client', id: 'z' }, context: {}, ttlSeconds: 3600 }), /ttl|asset/);
});

// ----- Processor (real FFmpeg in the pinned container) -------------------------
const available = processorAvailable();
const skip = available.ok ? false : `processor unavailable: ${available.reason}`;
const runner = new DockerToolRunner({ image: PROCESSOR_IMAGE });
const processor = new FfmpegMediaProcessor({ runner });

async function makeVideo(dir, name, args, inputs = []) {
  // Fixture generation uses the same pinned tool, writing into the test's own dir.
  await runner.run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', ...args, '-threads', '2', `/out/${name}`], { inputs, outputDir: dir, timeoutMs: 60_000 });
  return path.join(dir, name);
}

test('processor: probe reports oriented facts for MP4/WebM; abusive inputs refused', { skip }, async () => {
  const dir = tmp('probe');
  const mp4 = await makeVideo(dir, 'clip.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=3', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac']);
  const facts = await processor.probe({ sourcePath: mp4, container: 'mp4' });
  assert.equal(facts.width, 640); assert.equal(facts.height, 360); assert.equal(facts.hasAudio, true);
  assert.ok(Math.abs(facts.durationMs - 3000) < 100, String(facts.durationMs));
  const webm = await makeVideo(dir, 'clip.webm', ['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=15:duration=2', '-c:v', 'libvpx-vp9', '-b:v', '200k']);
  assert.equal((await processor.probe({ sourcePath: webm, container: 'webm' })).videoCodec, 'vp9');
  const rotated = await makeVideo(dir, 'rotated.mov', ['-display_rotation', '90', '-i', mp4, '-c', 'copy'], [mp4]);
  const r = await processor.probe({ sourcePath: rotated, container: 'mov' });
  assert.equal(r.width, 360); assert.equal(r.height, 640); assert.equal(r.rotation, 270);
  // Abuse: truncated bytes, too long, too fast, extra video stream, legacy codec.
  const truncated = path.join(dir, 'truncated.mp4');
  fs.writeFileSync(truncated, fs.readFileSync(mp4).subarray(0, 4096));
  await assert.rejects(processor.probe({ sourcePath: truncated, container: 'mp4' }), (e) => e instanceof MediaError && ['corrupt_video', 'video_duration_out_of_range'].includes(e.code));
  const long = await makeVideo(dir, 'long.mp4', ['-f', 'lavfi', '-i', 'color=c=gray:size=160x160:rate=1:duration=121', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']);
  await assert.rejects(processor.probe({ sourcePath: long, container: 'mp4' }), /video_duration_out_of_range/);
  const fast = await makeVideo(dir, 'fast.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=120:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']);
  await assert.rejects(processor.probe({ sourcePath: fast, container: 'mp4' }), /video_frame_rate_out_of_range/);
  const two = await makeVideo(dir, 'two.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10:duration=1', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10:duration=1', '-map', '0', '-map', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']);
  await assert.rejects(processor.probe({ sourcePath: two, container: 'mp4' }), /too_many_streams/);
  const legacy = await makeVideo(dir, 'legacy.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10:duration=1', '-c:v', 'mpeg4']);
  await assert.rejects(processor.probe({ sourcePath: legacy, container: 'mp4' }), /unsupported_video_codec/);
  // A playlist renamed .mp4 never reaches FFmpeg: the byte sniff refuses it.
  assert.throws(() => sniffVideoContainer(Buffer.from('#EXTM3U\n#EXTINF:1,\nhttp://127.0.0.1:9/x.ts\n')), /remote_playlist_rejected/);
});

test('processor: image poster applies EXIF orientation, crops 16:9, strips metadata, fits budget', { skip }, async () => {
  const dir = tmp('image');
  const source = path.join(dir, 'portrait.jpg');
  fs.writeFileSync(source, exifJpeg(1920, 1080));
  const facts = sniffImage(fs.readFileSync(source));
  assert.equal(facts.width, 1080); assert.equal(facts.height, 1920); assert.equal(facts.hasGps, true);
  await processor.verifyImage({ sourcePath: source, facts });
  // Top band of the displayed portrait: must be red after orientation.
  const crop = { x: 0, y: 0, width: 1, height: (1080 * 9 / 16) / 1920 };
  const out = path.join(dir, 'poster.jpg');
  const result = await processor.renderImage({ sourcePath: source, facts, crop, outputPath: out });
  assert.equal(result.width, 640); assert.equal(result.height, 360); assert.ok(result.bytes <= 160 * 1024);
  const bytes = fs.readFileSync(out);
  assert.equal(bytes.indexOf(Buffer.from('Exif')), -1, 'no EXIF in derivative');
  assert.equal(bytes.indexOf(Buffer.from('GPS')), -1, 'no GPS in derivative');
  const { loadImage } = require('@napi-rs/canvas');
  const img = await loadImage(bytes);
  const g = createCanvas(img.width, img.height).getContext('2d');
  g.drawImage(img, 0, 0);
  const [rr, gg, bb] = g.getImageData(320, 180, 1, 1).data;
  assert.ok(rr > 150 && bb < 100, `expected red from the oriented top band, got ${rr},${gg},${bb}`);
  // PNG and static WebP decode and render; truncated bytes fail before ready.
  for (const [name, mime] of [['plain.png', 'image/png'], ['plain.webp', 'image/webp']]) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, syntheticFrame(1280, 720).toBuffer(mime));
    const f = sniffImage(fs.readFileSync(file));
    await processor.verifyImage({ sourcePath: file, facts: f });
    const r = await processor.renderImage({ sourcePath: file, facts: f, crop: { x: 0, y: 0, width: 1, height: 1 }, outputPath: path.join(dir, `${name}.jpg`) });
    assert.equal(r.width, 640);
  }
  const broken = path.join(dir, 'broken.jpg');
  const good = syntheticFrame(1280, 720).toBuffer('image/jpeg', 90);
  fs.writeFileSync(broken, good.subarray(0, Math.floor(good.length / 3)));
  await assert.rejects(processor.verifyImage({ sourcePath: broken, facts: sniffImage(fs.readFileSync(broken)) }), (e) => e instanceof MediaError && e.code === 'corrupt_image');
  // Header dimensions that disagree with the decoded frame are refused.
  await assert.rejects(processor.verifyImage({ sourcePath: path.join(dir, 'plain.png'), facts: { ...sniffImage(fs.readFileSync(path.join(dir, 'plain.png'))), width: 999 } }), /corrupt_image/);
});

test('processor: video recipe renders bounded poster/end/preview/instruction derivatives', { skip }, async () => {
  const dir = tmp('render');
  const source = await makeVideo(dir, 'source.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=6', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac']);
  const facts = await processor.probe({ sourcePath: source, container: 'mp4' });
  const out = tmp('render-out');
  const full = { x: 0, y: 0, width: 1, height: 1 };
  const outputs = await processor.renderVideo({
    sourcePath: source, facts, outputDir: out,
    recipe: { poster_mode: 'video_frame', poster_frame_ms: 1000, poster_crop: full, end_frame_ms: 5000, end_frame_crop: full, preview_start_ms: 1000, preview_end_ms: 3000, preview_crop: null, include_instruction: true },
  });
  const byRole = Object.fromEntries(outputs.map((o) => [o.role, o]));
  assert.deepEqual(Object.keys(byRole).sort(), ['end_frame', 'instruction', 'poster', 'preview']);
  assert.equal(byRole.poster.width, 640); assert.ok(byRole.poster.bytes <= 160 * 1024);
  assert.equal(byRole.preview.mime_type, 'video/mp4'); assert.equal(byRole.preview.has_audio, false);
  assert.ok(Math.abs(byRole.preview.duration_ms - 2000) <= 100, String(byRole.preview.duration_ms));
  assert.ok(byRole.preview.width <= 720 && byRole.preview.bytes <= 2 * 1024 * 1024);
  assert.ok(byRole.preview.fast_start, 'preview moov precedes mdat');
  assert.equal(byRole.instruction.has_audio, true);
  assert.ok(Math.max(byRole.instruction.width, byRole.instruction.height) <= 1080 && byRole.instruction.bytes <= 25 * 1024 * 1024);
  assert.ok(byRole.instruction.fast_start);
  for (const o of outputs) assert.ok(fs.existsSync(o.path) && o.sha256.length === 64);
  const probeInstruction = await processor.probe({ sourcePath: byRole.instruction.path, container: 'mp4' });
  assert.equal(probeInstruction.videoCodec, 'h264');
  // Custom uploaded poster + preview only: no instruction, no end frame.
  const portrait = tmp('render-portrait');
  const vertical = await makeVideo(portrait, 'vertical.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=24:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']);
  const vf = await processor.probe({ sourcePath: vertical, container: 'mp4' });
  const band = { x: 0, y: 0.25, width: 1, height: (720 * 9 / 16) / 1280 };
  const only = await processor.renderVideo({ sourcePath: vertical, facts: vf, outputDir: tmp('render-only'), recipe: { poster_mode: 'uploaded_image', preview_start_ms: 0, preview_end_ms: 1500, preview_crop: band, include_instruction: false } });
  assert.deepEqual(only.map((o) => o.role), ['preview']);
  assert.equal(only[0].width, 720 > 640 ? Math.min(720, 720) : only[0].width);
});

test('processor: a stalled tool is killed at its timeout with a safe code', { skip }, async () => {
  const dir = tmp('timeout');
  const started = Date.now();
  await assert.rejects(
    runner.run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=60:duration=600', '-c:v', 'libx264', '-preset', 'veryslow', '/out/never.mp4'], { outputDir: dir, timeoutMs: 1500 }),
    (e) => e instanceof MediaError && e.code === 'processor_timeout',
  );
  assert.ok(Date.now() - started < 15_000, 'timeout bounded');
  const { execFileSync } = require('node:child_process');
  const still = execFileSync('docker', ['ps', '-q', '--filter', 'label=com.cvfpt.owner=cvfpt-media-processor', '--filter', 'status=running']).toString().trim();
  assert.equal(still, '', 'no processor container left running');
});
