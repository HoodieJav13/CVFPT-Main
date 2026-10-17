// Optional local still selection (docs/exercise-guides/design.md): a frame is
// chosen from a clip on the coach's device and ONLY the resulting image is
// uploaded through the normal photo pipeline. Pure helpers: output size, the
// binding between a confirmed still and its exact source/time, and checks on
// what the browser actually exported.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STILL_LIMITS, checkStillBlob, confirmationIsCurrent, sourceKey, stillDimensions, stillFileName,
} from '../../src/lib/localStill.js';

test('stills are downscaled to a useful long edge and never upscaled', () => {
  assert.equal(STILL_LIMITS.maxLongEdge, 1920);
  assert.deepEqual(stillDimensions(3840, 2160), { width: 1920, height: 1080 });
  assert.deepEqual(stillDimensions(2160, 3840), { width: 1080, height: 1920 });
  assert.deepEqual(stillDimensions(4000, 3000), { width: 1920, height: 1440 });
  assert.deepEqual(stillDimensions(1280, 720), { width: 1280, height: 720 });
  assert.deepEqual(stillDimensions(1920, 1081), { width: 1920, height: 1081 });
  assert.equal(stillDimensions(0, 0), null);
  assert.equal(stillDimensions(320, 120), null, 'below the existing 160 px minimum edge');
});

test('a confirmed still is bound to the exact source file and time', () => {
  const file = { name: 'synthetic-clip.mp4', size: 123456, lastModified: 1700000000000 };
  const confirmed = { key: sourceKey(file), timeMs: 1500 };
  assert.equal(confirmationIsCurrent(confirmed, { file, timeMs: 1500 }), true);
  assert.equal(confirmationIsCurrent(confirmed, { file, timeMs: 1501 }), false, 'any scrub invalidates it');
  assert.equal(confirmationIsCurrent(confirmed, { file: { ...file, lastModified: 1 }, timeMs: 1500 }), false, 'another file invalidates it');
  assert.equal(confirmationIsCurrent(confirmed, { file: { ...file, size: 1 }, timeMs: 1500 }), false);
  assert.equal(confirmationIsCurrent(null, { file, timeMs: 1500 }), false);
});

test('what the browser exported is checked before it is offered for upload', () => {
  assert.equal(checkStillBlob({ size: 90_000, type: 'image/jpeg' }), null);
  assert.equal(checkStillBlob({ size: 90_000, type: 'image/png' }), null);
  assert.equal(checkStillBlob({ size: 0, type: 'image/jpeg' })?.code, 'empty');
  assert.equal(checkStillBlob({ size: 90_000, type: 'video/mp4' })?.code, 'unsupported_type');
  assert.equal(checkStillBlob({ size: 90_000, type: '' })?.code, 'unsupported_type');
  assert.equal(checkStillBlob({ size: 10 * 1024 * 1024 + 1, type: 'image/jpeg' })?.code, 'too_large');
  assert.equal(checkStillBlob(null)?.code, 'empty');
});

test('still file names carry the chosen time and the image type, never the clip type', () => {
  assert.equal(stillFileName(83_400, 'image/jpeg', 'Synthetic Clip.MOV'), 'still-1m23.4s-synthetic-clip.jpg');
  assert.equal(stillFileName(500, 'image/png', 'a.mp4'), 'still-0m00.5s-a.png');
  assert.equal(stillFileName(0, 'image/webp', '../../evil name.webm'), 'still-0m00.0s-evil-name.webp');
});
