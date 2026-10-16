import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MEDIA_LIMITS, checkFileBeforeUpload, defaultCrop, cropAspectOk, moveCrop, zoomCrop, validatePreview, clampTime, formatMs,
  createLinkCache, absoluteMediaUrl, actorKey, nextPosterTargets, createRefreshGate,
} from '../../src/lib/exerciseMedia.js';

const landscape = { width: 1600, height: 900 };
const portrait = { width: 1080, height: 1350 };

test('early file checks mirror the server limits and never replace server validation', () => {
  assert.equal(checkFileBeforeUpload({ size: 1000, type: 'image/jpeg', name: 'a.jpg' }, 'source_image'), null);
  assert.equal(checkFileBeforeUpload({ size: MEDIA_LIMITS.image.maxBytes + 1, type: 'image/jpeg', name: 'a.jpg' }, 'source_image').code, 'file_too_large');
  assert.equal(checkFileBeforeUpload({ size: 10, type: 'image/svg+xml', name: 'a.svg' }, 'source_image').code, 'unsupported_type');
  assert.equal(checkFileBeforeUpload({ size: 10, type: 'image/gif', name: 'a.gif' }, 'source_image').code, 'unsupported_type');
  assert.equal(checkFileBeforeUpload({ size: 10, type: '', name: 'clip.mov' }, 'source_video'), null, 'some phones omit MIME: extension hint ok, server decides');
  assert.equal(checkFileBeforeUpload({ size: MEDIA_LIMITS.video.maxBytes + 1, type: 'video/mp4', name: 'a.mp4' }, 'source_video').code, 'file_too_large');
  assert.equal(checkFileBeforeUpload({ size: 0, type: 'image/png', name: 'a.png' }, 'source_image').code, 'empty_file');
  assert.equal(checkFileBeforeUpload(null, 'source_image').code, 'file_required');
});

test('crop helpers keep 16:9 in oriented pixels, stay in bounds and never stretch', () => {
  const crop = defaultCrop(landscape);
  assert.deepEqual(crop, { x: 0, y: 0, width: 1, height: 1 });
  assert.ok(cropAspectOk(crop, landscape));
  const band = defaultCrop(portrait);
  assert.equal(band.x, 0); assert.equal(band.width, 1);
  assert.ok(Math.abs(band.height - (1080 * 9 / 16) / 1350) < 1e-9);
  assert.ok(Math.abs(band.y - (1 - band.height) / 2) < 1e-9, 'centered');
  assert.ok(cropAspectOk(band, portrait));
  assert.equal(cropAspectOk({ x: 0, y: 0, width: 0.5, height: 1 }, landscape), false);
  const moved = moveCrop(band, 0, 2);
  assert.ok(moved.y + moved.height <= 1 + 1e-9, 'clamped to the bottom edge');
  assert.deepEqual(moveCrop(band, -50, -50), { ...band, x: 0, y: 0 }, 'large moves clamp at the edges');
  const zoomed = zoomCrop(crop, landscape, 0.5);
  assert.ok(Math.abs(zoomed.width - 0.5) < 1e-9 && Math.abs(zoomed.x - 0.25) < 1e-9, 'zoom in keeps center');
  assert.ok(cropAspectOk(zoomed, landscape));
  assert.deepEqual(zoomCrop(zoomed, landscape, 10), crop, 'zoom out caps at the largest fitting crop');
  const tiny = zoomCrop(crop, landscape, 0.01);
  assert.ok(tiny.width * landscape.width >= 160 - 1e-6, 'minimum crop keeps a usable source area');
});

test('time selection: finite integers, preview 1–8 s, clamped scrubbing', () => {
  assert.equal(validatePreview(0, 1000, 6000), null);
  assert.equal(validatePreview(0, 999, 6000), 'invalid_preview_range');
  assert.equal(validatePreview(1000, 9001, 12000), 'invalid_preview_range');
  assert.equal(validatePreview(3000, 2000, 6000), 'invalid_preview_range');
  assert.equal(validatePreview(5000, 7000, 6000), 'time_out_of_range');
  assert.equal(validatePreview(Number.NaN, 2000, 6000), 'invalid_time');
  assert.equal(validatePreview('0', 2000, 6000), 'invalid_time');
  assert.equal(clampTime(-5, 6000), 0);
  assert.equal(clampTime(6000, 6000), 5999);
  assert.equal(clampTime(1234.6, 6000), 1235);
  assert.equal(clampTime(Number.POSITIVE_INFINITY, 6000), 5999);
  assert.equal(formatMs(61500), '1:01.5');
  assert.equal(formatMs(0), '0:00.0');
});

test('link cache: batches, deduplicates in-flight work, refreshes near expiry, scopes by actor', async () => {
  let now = 1_000_000;
  const calls = [];
  let release;
  const cache = createLinkCache({
    now: () => now, marginMs: 10_000,
    request: async (context, assetIds) => {
      calls.push(assetIds);
      await new Promise((resolve) => { release = resolve; });
      return { links: assetIds.filter((id) => id !== 'missing').map((id) => ({ asset_id: id, url: `/api/exercise-media/content/${id}-${calls.length}`, expires_at: new Date(now + 60_000).toISOString() })), missing: assetIds.filter((id) => id === 'missing') };
    },
  });
  const context = { type: 'workout_log', id: 'log1' };
  const first = cache.get({ actor: 'client:1', context, assetIds: ['a', 'b', 'missing'] });
  const second = cache.get({ actor: 'client:1', context, assetIds: ['a'] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  release();
  const [one, two] = await Promise.all([first, second]);
  assert.equal(calls.length, 1, 'in-flight request shared');
  assert.equal(one.get('a'), two.get('a'));
  assert.equal(one.has('missing'), false);
  // Cached until 10 s before expiry, then one refresh.
  const cached = await cache.get({ actor: 'client:1', context, assetIds: ['a'] });
  assert.equal(calls.length, 1); assert.equal(cached.get('a'), one.get('a'));
  now += 51_000;
  const refreshing = cache.get({ actor: 'client:1', context, assetIds: ['a'] });
  await new Promise((resolve) => setTimeout(resolve, 0)); release();
  assert.notEqual((await refreshing).get('a'), one.get('a'));
  assert.equal(calls.length, 2);
  // Another actor never sees this actor's links.
  const other = cache.get({ actor: 'client:2', context, assetIds: ['a'] });
  await new Promise((resolve) => setTimeout(resolve, 0)); release();
  await other;
  assert.equal(calls.length, 3);
  cache.clear();
  const afterClear = cache.get({ actor: 'client:1', context, assetIds: ['a'] });
  await new Promise((resolve) => setTimeout(resolve, 0)); release();
  await afterClear;
  assert.equal(calls.length, 4, 'clear drops every cached link');
  assert.throws(() => cache.get({ actor: 'client:1', context, assetIds: Array.from({ length: 21 }, (_, i) => `x${i}`) }), /20/);
});

test('link cache: explicit invalidate forces exactly one fresh request; failures are not cached', async () => {
  let fail = true;
  let count = 0;
  const cache = createLinkCache({ now: () => 0, request: async (_c, ids) => { count += 1; if (fail) throw new Error('503'); return { links: ids.map((id) => ({ asset_id: id, url: `/u/${id}/${count}`, expires_at: new Date(60_000).toISOString() })), missing: [] }; } });
  const context = { type: 'workout_log', id: 'l' };
  await assert.rejects(cache.get({ actor: 'a', context, assetIds: ['p'] }), /503/);
  fail = false;
  assert.equal((await cache.get({ actor: 'a', context, assetIds: ['p'] })).get('p'), '/u/p/2');
  cache.invalidate('a', context, 'p');
  assert.equal((await cache.get({ actor: 'a', context, assetIds: ['p'] })).get('p'), '/u/p/3');
});

test('helpers: absolute URLs, actor keys, and only the active+next posters load', () => {
  assert.equal(absoluteMediaUrl('/api/exercise-media/content/abc.def', 'http://127.0.0.1:5000/api'), 'http://127.0.0.1:5000/api/exercise-media/content/abc.def');
  assert.equal(absoluteMediaUrl('/api/exercise-media/content/abc.def', '/api'), '/api/exercise-media/content/abc.def');
  assert.equal(absoluteMediaUrl('/api/exercise-media/content/../../x', '/api'), null);
  assert.equal(absoluteMediaUrl('javascript:alert(1)', '/api'), null);
  assert.equal(absoluteMediaUrl('https://evil.example/x', '/api'), null, 'only API content paths');
  assert.equal(actorKey({ role: 'client', profile: { id: 'c1' } }), 'client:c1');
  assert.equal(actorKey(null), null);
  const rows = ['e1', 'e2', 'e3', 'e4'].map((id) => ({ id, media: id === 'e3' ? null : { poster: { asset_id: `p-${id}` } } }));
  assert.deepEqual([...nextPosterTargets(rows, 'e1')], ['e1', 'e2']);
  assert.deepEqual([...nextPosterTargets(rows, 'e2')], ['e2', 'e4'], 'next exercise WITH media');
  assert.deepEqual([...nextPosterTargets(rows, 'e4')], ['e4']);
  assert.deepEqual([...nextPosterTargets(rows, null)], ['e1', 'e2']);
});

test('link cache: one caller aborting never fails a shared in-flight request for others', async () => {
  let release;
  const cache = createLinkCache({
    now: () => 0,
    request: async (_context, ids, options = {}) => {
      await new Promise((resolve) => { release = resolve; });
      if (options.signal?.aborted) throw new Error('canceled');
      return { links: ids.map((id) => ({ asset_id: id, url: `/u/${id}`, expires_at: new Date(60_000).toISOString() })), missing: [] };
    },
  });
  const context = { type: 'workout_log', id: 'l' };
  const first = new AbortController();
  const abandoned = cache.get({ actor: 'a', context, assetIds: ['p'], signal: first.signal });
  first.abort(); // e.g. React dev double-mount or a fast unmount
  const kept = cache.get({ actor: 'a', context, assetIds: ['p'] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  release();
  assert.equal((await kept).get('p'), '/u/p');
  await abandoned.catch(() => null);
});

test('refresh gate: one fresh link per successful load, then a real failure', () => {
  const gate = createRefreshGate();
  assert.equal(gate.onError(), 'refresh');
  assert.equal(gate.onError(), 'failed', 'a second failure without a successful load is real');
  gate.onLoaded();
  assert.equal(gate.onError(), 'refresh', 'a later expiry after a good load refreshes again');
  assert.equal(gate.onError(), 'failed');
  gate.reset();
  assert.equal(gate.onError(), 'refresh', 'an explicit retry restores the budget');
});
