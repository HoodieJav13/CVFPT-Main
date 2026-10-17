// Exercise media configuration modes (docs/exercise-guides/design.md):
// photos is the default local mode (image-only, no FFmpeg/worker); the owned
// full video pipeline is explicit opt-in; the hosted Supabase adapter is never
// activated by configuration in this build; Production/Vercel stay disabled.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mediaConfig } = require('../src/lib/exerciseMedia/config');
const { buildRuntime } = require('../src/lib/exerciseMedia/runtime');
const { ImageOnlyProcessor } = require('../src/services/exerciseMedia/imageProcessor');
const { FfmpegMediaProcessor } = require('../src/services/exerciseMedia/ffmpegProcessor');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cvf-media-config-'));
const local = { EXERCISE_MEDIA_STORE: 'local', EXERCISE_MEDIA_ROOT: root, EXERCISE_MEDIA_LINK_SECRET: 'x'.repeat(40) };

test('local media defaults to photos mode; full video is explicit opt-in', () => {
  assert.equal(mediaConfig(local).enabled, true);
  assert.equal(mediaConfig(local).mode, 'photos');
  assert.equal(mediaConfig({ ...local, EXERCISE_MEDIA_MODE: 'full' }).mode, 'full');
  assert.equal(mediaConfig({ ...local, EXERCISE_MEDIA_MODE: 'video-everything' }).mode, 'photos');
});

test('the hosted adapter is never activated by configuration in this build', () => {
  const hosted = mediaConfig({ EXERCISE_MEDIA_STORE: 'supabase', EXERCISE_MEDIA_BUCKET: 'exercise-media-private' });
  assert.equal(hosted.enabled, false);
  assert.equal(hosted.hostedAdapter, 'requires_separate_activation');
  assert.equal(mediaConfig({ ...local, VERCEL: '1' }).enabled, false);
  assert.equal(mediaConfig({ ...local, NODE_ENV: 'production' }).enabled, false);
  assert.equal(mediaConfig({}).enabled, false);
});

test('runtime wiring: photos uses the in-process image processor, full keeps FFmpeg', () => {
  const db = { from() { throw new Error('no queries while wiring'); }, rpc() { throw new Error('no rpc while wiring'); } };
  const photos = buildRuntime(mediaConfig(local), { db });
  assert.ok(photos.processor instanceof ImageOnlyProcessor);
  assert.equal(photos.mode, 'photos');
  const caps = photos.service.capabilities();
  assert.deepEqual([caps.mode, caps.video_sources, caps.upload_transport, caps.processing, caps.processing_available], ['photos', false, 'grant', 'inline', true]);
  const full = buildRuntime(mediaConfig({ ...local, EXERCISE_MEDIA_MODE: 'full' }), { db, processorAvailable: () => ({ ok: false, reason: 'test' }) });
  assert.ok(full.processor instanceof FfmpegMediaProcessor);
  assert.deepEqual([full.service.capabilities().mode, full.service.capabilities().upload_transport], ['full', 'multipart']);
  assert.equal(buildRuntime(mediaConfig({}), { db }), null);
});
