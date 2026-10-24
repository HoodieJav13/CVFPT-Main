// The browser's early media checks are a duplicated copy (no imports across
// the deploy boundary). This keeps the duplicated limits in sync.
const test = require('node:test');
const assert = require('node:assert/strict');
const { LIMITS, cropMatchesAspect } = require('../src/lib/exerciseMedia/validation');

test('browser media limits match the backend limits they mirror', async () => {
  const { MEDIA_LIMITS, cropAspectOk, defaultCrop } = await import('../../frontend/src/lib/exerciseMedia.js');
  assert.equal(MEDIA_LIMITS.image.maxBytes, LIMITS.image.maxBytes);
  assert.equal(MEDIA_LIMITS.image.minEdge, LIMITS.image.minEdge);
  assert.equal(MEDIA_LIMITS.image.maxEdge, LIMITS.image.maxEdge);
  assert.deepEqual(MEDIA_LIMITS.image.mimes, LIMITS.image.mimes);
  assert.equal(MEDIA_LIMITS.video.maxBytes, LIMITS.video.maxBytes);
  assert.equal(MEDIA_LIMITS.video.maxDurationMs, LIMITS.video.maxDurationMs);
  assert.deepEqual(MEDIA_LIMITS.video.mimes, LIMITS.video.mimes);
  assert.equal(MEDIA_LIMITS.preview.minMs, LIMITS.preview.minMs);
  assert.equal(MEDIA_LIMITS.preview.maxMs, LIMITS.preview.maxMs);
  for (const key of ['altMax', 'cueMax', 'cuesMax', 'transcriptMax', 'rightsNoteMax']) assert.equal(MEDIA_LIMITS.text[key], LIMITS.text[key], key);
  assert.equal(MEDIA_LIMITS.crop.aspect, LIMITS.crop.aspect);
  assert.equal(MEDIA_LIMITS.crop.tolerance, LIMITS.crop.tolerance);
  assert.equal(MEDIA_LIMITS.links.maxAssets, LIMITS.links.maxAssets);
  // The browser's default crop is always one the server accepts.
  for (const dims of [{ width: 1600, height: 900 }, { width: 1080, height: 1920 }, { width: 160, height: 8192 }, { width: 3840, height: 1600 }]) {
    const crop = defaultCrop(dims);
    assert.equal(cropAspectOk(crop, dims), true);
    assert.equal(cropMatchesAspect(crop, dims), true, JSON.stringify(dims));
  }
});
