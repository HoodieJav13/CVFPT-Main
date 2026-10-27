const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LIMITS, MediaError, sniffImage, assertImageFacts, sniffVideoContainer, normalizeProbe,
  normalizeRecipePatch, captionsToWebVtt, sanitizeDisplayName, parseRange, isUuid, cropMatchesAspect,
} = require('../src/lib/exerciseMedia/validation');

// ----- Crafted headers (no real decoder involved) ---------------------------
function u16be(n) { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; }
function u32be(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; }
function exifSegment({ orientation = 1, gps = false } = {}) {
  // Big-endian TIFF with IFD0 holding Orientation and (optionally) a GPS pointer.
  const entries = [[0x0112, 3, 1, orientation << 16]];
  if (gps) entries.push([0x8825, 4, 1, 26 + 12 * 2]);
  const ifd = Buffer.concat([u16be(entries.length), ...entries.map(([tag, type, count, value]) => Buffer.concat([u16be(tag), u16be(type), u32be(count), u32be(value)])), u32be(0)]);
  const tiff = Buffer.concat([Buffer.from('MM'), u16be(42), u32be(8), ifd]);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  return Buffer.concat([Buffer.from([0xff, 0xe1]), u16be(payload.length + 2), payload]);
}
function jpeg({ width = 1280, height = 720, orientation, gps, sof = 0xc0 } = {}) {
  const sofBody = Buffer.concat([Buffer.from([8]), u16be(height), u16be(width), Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    orientation || gps ? exifSegment({ orientation: orientation || 1, gps }) : Buffer.alloc(0),
    Buffer.from([0xff, sof]), u16be(sofBody.length + 2), sofBody,
    Buffer.from([0xff, 0xda, 0, 2]), Buffer.alloc(32, 0x11), Buffer.from([0xff, 0xd9]),
  ]);
}
function pngChunk(type, data) { return Buffer.concat([u32be(data.length), Buffer.from(type, 'ascii'), data, u32be(0)]); }
function png({ width = 800, height = 600, animated = false } = {}) {
  const ihdr = Buffer.concat([u32be(width), u32be(height), Buffer.from([8, 6, 0, 0, 0])]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr),
    animated ? pngChunk('acTL', Buffer.concat([u32be(2), u32be(0)])) : Buffer.alloc(0),
    pngChunk('IDAT', Buffer.alloc(16)), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
function riff(chunks) {
  const body = Buffer.concat([Buffer.from('WEBP'), ...chunks]);
  const size = Buffer.alloc(4); size.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from('RIFF'), size, body]);
}
function webpChunk(type, data) { const s = Buffer.alloc(4); s.writeUInt32LE(data.length); return Buffer.concat([Buffer.from(type), s, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]); }
function webpVp8x({ width = 640, height = 480, animated = false } = {}) {
  const d = Buffer.alloc(10);
  d[0] = animated ? 0x02 : 0;
  d.writeUIntLE(width - 1, 4, 3); d.writeUIntLE(height - 1, 7, 3);
  return riff([webpChunk('VP8X', d), animated ? webpChunk('ANIM', Buffer.alloc(6)) : webpChunk('VP8 ', vp8Frame(width, height))]);
}
function vp8Frame(width, height) {
  const d = Buffer.alloc(20);
  d[3] = 0x9d; d[4] = 0x01; d[5] = 0x2a; d.writeUInt16LE(width, 6); d.writeUInt16LE(height, 8);
  return d;
}
function webpLossy(width = 900, height = 500) { return riff([webpChunk('VP8 ', vp8Frame(width, height))]); }
function webpLossless(width = 300, height = 200) {
  const d = Buffer.alloc(10); d[0] = 0x2f;
  const bits = (width - 1) | ((height - 1) << 14);
  d.writeUInt32LE(bits >>> 0, 1);
  return riff([webpChunk('VP8L', d)]);
}
const code = (fn) => { try { fn(); } catch (error) { assert.ok(error instanceof MediaError, String(error)); return error.code; } return 'accepted'; };

test('images: JPEG/PNG/WebP sniffed from bytes with oriented dimensions', () => {
  assert.deepEqual(sniffImage(jpeg()), { format: 'jpeg', mime: 'image/jpeg', ext: 'jpg', width: 1280, height: 720, orientation: 1, animated: false, hasGps: false });
  const rotated = sniffImage(jpeg({ width: 1280, height: 720, orientation: 6, gps: true }));
  assert.equal(rotated.width, 720); assert.equal(rotated.height, 1280); assert.equal(rotated.orientation, 6); assert.equal(rotated.hasGps, true);
  assert.equal(sniffImage(jpeg({ sof: 0xc2 })).width, 1280, 'progressive SOF2');
  assert.deepEqual(sniffImage(png()), { format: 'png', mime: 'image/png', ext: 'png', width: 800, height: 600, orientation: 1, animated: false, hasGps: false });
  assert.equal(sniffImage(webpLossy()).width, 900);
  assert.equal(sniffImage(webpLossless()).height, 200);
  assert.equal(sniffImage(webpVp8x()).width, 640);
});

test('images: animated, vector, GIF, unknown, truncated and bombs are refused before decode', () => {
  assert.equal(code(() => assertImageFacts(sniffImage(png({ animated: true })), 1000)), 'animated_image_not_supported');
  assert.equal(code(() => assertImageFacts(sniffImage(webpVp8x({ animated: true })), 1000)), 'animated_image_not_supported');
  assert.equal(code(() => sniffImage(Buffer.from('GIF89a\x01\x00\x01\x00', 'binary'))), 'unsupported_image_type');
  assert.equal(code(() => sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))), 'unsupported_image_type');
  assert.equal(code(() => sniffImage(Buffer.from('<?xml version="1.0"?><svg/>'))), 'unsupported_image_type');
  assert.equal(code(() => sniffImage(Buffer.from('%PDF-1.7 not an image'))), 'unsupported_image_type');
  assert.equal(code(() => sniffImage(Buffer.alloc(0))), 'unsupported_image_type');
  assert.equal(code(() => sniffImage(jpeg().subarray(0, 12))), 'corrupt_image');
  assert.equal(code(() => sniffImage(png().subarray(0, 20))), 'corrupt_image');
  assert.equal(code(() => assertImageFacts(sniffImage(png({ width: 159, height: 400 })), 1000)), 'image_dimensions_out_of_range');
  assert.equal(code(() => assertImageFacts(sniffImage(png({ width: 8193, height: 400 })), 1000)), 'image_dimensions_out_of_range');
  assert.equal(code(() => assertImageFacts(sniffImage(png({ width: 8000, height: 8000 })), 1000)), 'image_too_many_pixels');
  assert.equal(code(() => assertImageFacts(sniffImage(png({ width: 0, height: 0 })), 1000)), 'image_dimensions_out_of_range');
  assert.equal(code(() => assertImageFacts(sniffImage(png()), LIMITS.image.maxBytes + 1)), 'file_too_large');
  assert.equal(code(() => assertImageFacts(sniffImage(png({ width: 8192, height: 160 })), 1000)), 'accepted');
});

test('videos: container sniffed from bytes; playlists and lookalikes refused', () => {
  const ftyp = (brand) => Buffer.concat([u32be(24), Buffer.from('ftyp'), Buffer.from(brand), u32be(0), Buffer.from('isom'), Buffer.from('mp41')]);
  assert.deepEqual(sniffVideoContainer(ftyp('isom')), { container: 'mp4', mime: 'video/mp4', ext: 'mp4' });
  assert.deepEqual(sniffVideoContainer(ftyp('qt  ')), { container: 'mov', mime: 'video/quicktime', ext: 'mov' });
  const ebml = (doctype) => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x80 | doctype.length]), Buffer.from(doctype), Buffer.alloc(8)]);
  assert.deepEqual(sniffVideoContainer(ebml('webm')), { container: 'webm', mime: 'video/webm', ext: 'webm' });
  assert.equal(code(() => sniffVideoContainer(ebml('matroska'))), 'unsupported_video_container');
  assert.equal(code(() => sniffVideoContainer(Buffer.from('#EXTM3U\n#EXT-X-VERSION:3\nhttp://example.invalid/a.ts'))), 'remote_playlist_rejected');
  assert.equal(code(() => sniffVideoContainer(Buffer.from('GIF89a........'))), 'unsupported_video_container');
  assert.equal(code(() => sniffVideoContainer(jpeg())), 'unsupported_video_container');
  assert.equal(code(() => sniffVideoContainer(Buffer.alloc(3))), 'unsupported_video_container');
});

const probeOf = (overrides = {}, streams) => ({
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '6.000000', nb_streams: streams ? streams.length : 1, ...overrides.format },
  streams: streams || [{ index: 0, codec_type: 'video', codec_name: 'h264', width: 1280, height: 720, avg_frame_rate: '30/1', r_frame_rate: '30/1', ...overrides.video }],
});

test('probe: duration, codec, stream, dimension and frame-rate bounds', () => {
  assert.deepEqual(normalizeProbe(probeOf(), 'mp4'), { durationMs: 6000, width: 1280, height: 720, fps: 30, videoCodec: 'h264', hasAudio: false, rotation: 0 });
  const rotated = normalizeProbe(probeOf({ video: { side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }] } }), 'mov');
  assert.equal(rotated.width, 720); assert.equal(rotated.height, 1280); assert.equal(rotated.rotation, 90);
  const audio = probeOf({}, [probeOf().streams[0], { index: 1, codec_type: 'audio', codec_name: 'aac' }]);
  assert.equal(normalizeProbe(audio, 'mp4').hasAudio, true);
  assert.equal(code(() => normalizeProbe(probeOf({ format: { duration: '0' } }), 'mp4')), 'video_duration_out_of_range');
  assert.equal(code(() => normalizeProbe(probeOf({ format: { duration: '120.5' } }), 'mp4')), 'video_duration_out_of_range');
  assert.equal(code(() => normalizeProbe(probeOf({ format: { duration: 'N/A' } }), 'mp4')), 'video_duration_out_of_range');
  assert.equal(code(() => normalizeProbe(probeOf({ video: { codec_name: 'mpeg4' } }), 'mp4')), 'unsupported_video_codec');
  assert.equal(code(() => normalizeProbe(probeOf({ video: { width: 3841 } }), 'mp4')), 'video_dimensions_out_of_range');
  assert.equal(code(() => normalizeProbe(probeOf({ video: { width: 3840, height: 2400 } }), 'mp4')), 'video_too_many_pixels');
  assert.equal(code(() => normalizeProbe(probeOf({ video: { width: 120 } }), 'mp4')), 'video_dimensions_out_of_range');
  assert.equal(code(() => normalizeProbe(probeOf({ video: { avg_frame_rate: '120/1', r_frame_rate: '120/1' } }), 'mp4')), 'video_frame_rate_out_of_range');
  assert.equal(code(() => normalizeProbe(probeOf({}, [{ index: 0, codec_type: 'audio', codec_name: 'aac' }]), 'mp4')), 'no_video_stream');
  const two = probeOf({}, [probeOf().streams[0], { ...probeOf().streams[0], index: 1 }]);
  assert.equal(code(() => normalizeProbe(two, 'mp4')), 'too_many_streams');
  const subs = probeOf({}, [probeOf().streams[0], { index: 1, codec_type: 'subtitle', codec_name: 'mov_text' }]);
  assert.equal(code(() => normalizeProbe(subs, 'mp4')), 'unsupported_stream');
  const attach = probeOf({}, [probeOf().streams[0], { index: 1, codec_type: 'attachment' }]);
  assert.equal(code(() => normalizeProbe(attach, 'mp4')), 'unsupported_stream');
  assert.equal(code(() => normalizeProbe(probeOf({ format: { format_name: 'hls' } }), 'mp4')), 'container_mismatch');
  assert.equal(code(() => normalizeProbe(probeOf({ format: { format_name: 'matroska,webm' } }), 'mp4')), 'container_mismatch');
  assert.equal(code(() => normalizeProbe(null, 'mp4')), 'corrupt_video');
});

test('recipe: integer ms in range, 1–8s preview, crop shape and 16:9 aspect', () => {
  const video = { durationMs: 6000, width: 1280, height: 720 };
  const full = { x: 0, y: 0, width: 1, height: 1 };
  assert.deepEqual(normalizeRecipePatch({ poster_mode: 'video_frame', poster_frame_ms: 1200, poster_crop: full }, { video }),
    { poster_mode: 'video_frame', poster_frame_ms: 1200, poster_crop: full });
  assert.deepEqual(normalizeRecipePatch({ preview_start_ms: 0, preview_end_ms: 8000 }, { video: { ...video, durationMs: 9000 } }), { preview_start_ms: 0, preview_end_ms: 8000 });
  const bad = (patch, sources = { video }) => code(() => normalizeRecipePatch(patch, sources));
  assert.equal(bad({ poster_frame_ms: 'NaN' }), 'invalid_time');
  assert.equal(bad({ poster_frame_ms: '1200' }), 'invalid_time');
  assert.equal(bad({ poster_frame_ms: 1.5 }), 'invalid_time');
  assert.equal(bad({ poster_frame_ms: -1 }), 'invalid_time');
  assert.equal(bad({ poster_frame_ms: Number.POSITIVE_INFINITY }), 'invalid_time');
  assert.equal(bad({ poster_frame_ms: 6000 }), 'time_out_of_range');
  assert.equal(bad({ end_frame_ms: 6001 }), 'time_out_of_range');
  assert.equal(bad({ preview_start_ms: 3000, preview_end_ms: 2000 }), 'invalid_preview_range');
  assert.equal(bad({ preview_start_ms: 1000, preview_end_ms: 1500 }), 'invalid_preview_range');
  assert.equal(bad({ preview_start_ms: 0, preview_end_ms: 8001 }, { video: { ...video, durationMs: 9000 } }), 'invalid_preview_range');
  assert.equal(bad({ preview_start_ms: 1000 }), 'invalid_preview_range');
  assert.equal(bad({ preview_start_ms: 4000, preview_end_ms: 6500 }), 'time_out_of_range');
  assert.equal(bad({ poster_frame_ms: 100 }, {}), 'source_video_required');
  assert.equal(bad({ poster_crop: { x: 0.6, y: 0, width: 0.5, height: 1 } }), 'invalid_crop');
  assert.equal(bad({ poster_crop: { x: '0', y: 0, width: 1, height: 1 } }), 'invalid_crop');
  assert.equal(bad({ poster_crop: { x: 0, y: 0, width: 0.5, height: 1 } }), 'crop_aspect_mismatch', 'never stretch');
  assert.equal(bad({ poster_mode: 'gif' }), 'invalid_poster_mode');
  assert.equal(bad({ unknown: true }), 'invalid_field');
  // Portrait image source: a 16:9 crop is a narrow horizontal band.
  const image = { width: 1080, height: 1920 };
  const band = { x: 0, y: 0.3, width: 1, height: (1080 * 9 / 16) / 1920 };
  assert.deepEqual(normalizeRecipePatch({ poster_mode: 'uploaded_image', poster_crop: band }, { image }), { poster_mode: 'uploaded_image', poster_crop: band });
  assert.equal(cropMatchesAspect(band, image), true);
});

test('text: alt/cues/transcript/captions bounded, plain text only', () => {
  assert.deepEqual(normalizeRecipePatch({ alt_text: '  Synthetic kettlebell squat setup  ', cues: [' Brace ', 'Sit back'] }, {}),
    { alt_text: 'Synthetic kettlebell squat setup', cues: ['Brace', 'Sit back'] });
  const bad = (patch) => code(() => normalizeRecipePatch(patch, {}));
  assert.equal(bad({ alt_text: 'x'.repeat(241) }), 'alt_text_too_long');
  assert.equal(bad({ alt_text: '   ' }), 'alt_text_required');
  assert.equal(bad({ cues: ['a', 'b', 'c', 'd'] }), 'too_many_cues');
  assert.equal(bad({ cues: ['x'.repeat(161)] }), 'cue_too_long');
  assert.equal(bad({ cues: 'not an array' }), 'invalid_cues');
  assert.equal(bad({ transcript: 'x'.repeat(12001) }), 'transcript_too_long');
  assert.equal(bad({ caption_language: 'english' }), 'invalid_caption_language');
  assert.equal(bad({ caption_cues: [{ start_ms: 1000, end_ms: 500, text: 'x' }] }), 'invalid_caption_cues');
  assert.equal(bad({ caption_cues: Array.from({ length: 501 }, (_, i) => ({ start_ms: i, end_ms: i + 1, text: 'x' })) }), 'invalid_caption_cues');
  // Alt text can be rewritten but never removed; an end still may be cleared.
  assert.equal(bad({ alt_text: null }), 'alt_text_required');
  assert.deepEqual(normalizeRecipePatch({ end_frame_alt_text: null, transcript: '' }, {}), { end_frame_alt_text: null, transcript: null });
});

test('captions: escaped WebVTT, bounded size, no markup passes through', () => {
  const vtt = captionsToWebVtt([{ start_ms: 0, end_ms: 1500, text: 'Brace <b>now</b> & --> breathe' }, { start_ms: 61000, end_ms: 62500, text: 'Line two' }], 'en');
  assert.equal(vtt, 'WEBVTT\nLanguage: en\n\n1\n00:00:00.000 --> 00:00:01.500\nBrace &lt;b&gt;now&lt;/b&gt; &amp; --&gt; breathe\n\n2\n00:01:01.000 --> 00:01:02.500\nLine two\n');
  assert.equal(code(() => captionsToWebVtt([{ start_ms: 0, end_ms: 1, text: 'x'.repeat(70000) }], 'en')), 'invalid_caption_cues');
});

test('display names, ranges and ids', () => {
  assert.equal(sanitizeDisplayName('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeDisplayName('C:\\fakepath\\My Squat <clip>.MOV'), 'My Squat clip.MOV');
  assert.equal(sanitizeDisplayName('\u0000\u202e\u0007'), null);
  assert.equal(sanitizeDisplayName('a'.repeat(300)).length, 120);
  assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange('bytes=900-', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange('bytes=0-5000', 1000), { start: 0, end: 999 });
  assert.equal(parseRange('bytes=1000-', 1000), 'unsatisfiable');
  assert.equal(parseRange('bytes=5-2', 1000), 'unsatisfiable');
  assert.equal(parseRange('bytes=0-1,5-6', 1000), null, 'multi-range ignored: full response');
  assert.equal(parseRange('items=0-1', 1000), null);
  assert.equal(parseRange(undefined, 1000), null);
  assert.equal(isUuid('e0000000-0000-4000-8000-000000000001'), true);
  assert.equal(isUuid("e0000000-0000-4000-8000-000000000001' or 1=1"), false);
});
