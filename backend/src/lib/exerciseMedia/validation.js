// Pure exercise-media validation: byte sniffing, probe/recipe/text limits,
// WebVTT generation and Range parsing. No I/O. Browser-side early checks are
// duplicated in frontend/src/lib/exerciseMedia.js; parity is tested there and
// in backend/test/exercise-media-limits-parity.test.js. These are local
// acceptance limits, not claims about any hosted provider.

const MiB = 1024 * 1024;

const LIMITS = Object.freeze({
  image: Object.freeze({ maxBytes: 10 * MiB, minEdge: 160, maxEdge: 8192, maxPixels: 32_000_000, mimes: ['image/jpeg', 'image/png', 'image/webp'] }),
  video: Object.freeze({
    maxBytes: 100 * MiB, maxDurationMs: 120_000, minEdge: 160, maxEdge: 3840, maxPixels: 8_300_000, maxFps: 60,
    codecs: ['h264', 'hevc', 'vp8', 'vp9', 'av1'], mimes: ['video/mp4', 'video/quicktime', 'video/webm'],
  }),
  preview: Object.freeze({ minMs: 1000, maxMs: 8000, maxBytes: 2 * MiB, maxLongEdge: 720, maxFps: 24 }),
  poster: Object.freeze({ width: 640, height: 360, maxBytes: 160 * 1024 }),
  instruction: Object.freeze({ maxBytes: 25 * MiB, maxLongEdge: 1080, maxFps: 30 }),
  captions: Object.freeze({ maxCues: 500, maxTextChars: 12_000, maxCueChars: 500, maxVttBytes: 64 * 1024 }),
  text: Object.freeze({ altMax: 240, cueMax: 160, cuesMax: 3, transcriptMax: 12_000, rightsNoteMax: 1000, displayNameMax: 120 }),
  request: Object.freeze({ maxFields: 8, maxFieldBytes: 16 * 1024, maxFiles: 1, maxParts: 10, sniffBytes: 256 * 1024 }),
  links: Object.freeze({ maxAssets: 20, ttlSeconds: 60, instructionTtlSeconds: 300 }),
  uploads: Object.freeze({ perWindow: 10, windowMs: 15 * 60 * 1000 }),
  crop: Object.freeze({ aspect: 16 / 9, tolerance: 0.01 }),
  drafts: Object.freeze({ pageDefault: 30, pageMax: 100 }),
});

const STATUS_BY_CODE = {
  file_too_large: 413,
  unsupported_image_type: 415,
  unsupported_video_container: 415,
  remote_playlist_rejected: 415,
  unsupported_video_codec: 415,
};

class MediaError extends Error {
  constructor(code, status) {
    super(code);
    this.name = 'MediaError';
    this.code = code;
    this.status = status || STATUS_BY_CODE[code] || 422;
  }
}

const fail = (code, status) => { throw new MediaError(code, status); };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value) { return typeof value === 'string' && UUID_RE.test(value); }

// ----- EXIF (orientation + GPS presence only) ---------------------------------
function readTiff(buf, start, end) {
  const out = { orientation: 1, hasGps: false };
  if (end - start < 8) return out;
  const order = buf.toString('latin1', start, start + 2);
  const le = order === 'II';
  if (!le && order !== 'MM') return out;
  const u16 = (o) => (o + 2 <= end ? (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o)) : null);
  const u32 = (o) => (o + 4 <= end ? (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o)) : null);
  if (u16(start + 2) !== 42) return out;
  const ifd = u32(start + 4);
  if (ifd === null || start + ifd + 2 > end) return out;
  const count = Math.min(u16(start + ifd) || 0, 128);
  for (let i = 0; i < count; i += 1) {
    const entry = start + ifd + 2 + i * 12;
    if (entry + 12 > end) break;
    const tag = u16(entry);
    if (tag === 0x0112) {
      const value = u16(entry + 8);
      if (value >= 1 && value <= 8) out.orientation = value;
    } else if (tag === 0x8825) {
      out.hasGps = true;
    }
  }
  return out;
}

function orient(width, height, orientation) {
  return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
}

function imageResult(format, width, height, meta, animated) {
  const ext = format === 'jpeg' ? 'jpg' : format;
  const oriented = orient(width, height, meta.orientation);
  return { format, mime: `image/${format}`, ext, ...oriented, orientation: meta.orientation, animated, hasGps: meta.hasGps };
}

function sniffJpeg(buf) {
  let meta = { orientation: 1, hasGps: false };
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) fail('corrupt_image');
    while (buf[i] === 0xff && i < buf.length) i += 1;
    const marker = buf[i];
    i += 1;
    if (marker === undefined) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda) fail('corrupt_image');
    if (i + 2 > buf.length) fail('corrupt_image');
    const length = buf.readUInt16BE(i);
    if (length < 2 || i + length > buf.length) fail('corrupt_image');
    const body = i + 2;
    if (marker === 0xe1 && buf.toString('latin1', body, body + 6) === 'Exif\0\0') {
      meta = readTiff(buf, body + 6, i + length);
    }
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isSof) {
      if (length < 7) fail('corrupt_image');
      return imageResult('jpeg', buf.readUInt16BE(body + 3), buf.readUInt16BE(body + 1), meta, false);
    }
    i += length;
  }
  return fail('corrupt_image');
}

function sniffPng(buf) {
  if (buf.length < 33 || buf.toString('latin1', 12, 16) !== 'IHDR' || buf.readUInt32BE(8) !== 13) fail('corrupt_image');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  let meta = { orientation: 1, hasGps: false };
  let animated = false;
  let i = 33;
  for (;;) {
    if (i + 8 > buf.length) fail('corrupt_image');
    const length = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    if (type === 'IDAT' || type === 'IEND') break;
    if (i + 12 + length > buf.length) fail('corrupt_image');
    if (type === 'acTL') animated = true;
    if (type === 'eXIf') meta = readTiff(buf, i + 8, i + 8 + length);
    i += 12 + length;
  }
  return imageResult('png', width, height, meta, animated);
}

function sniffWebp(buf) {
  if (buf.length < 20 || buf.toString('latin1', 8, 12) !== 'WEBP') fail('corrupt_image');
  let i = 12;
  let width = null; let height = null; let animated = false;
  let meta = { orientation: 1, hasGps: false };
  while (i + 8 <= buf.length) {
    const type = buf.toString('latin1', i, i + 4);
    const size = buf.readUInt32LE(i + 4);
    const body = i + 8;
    if (body + size > buf.length && (type === 'VP8 ' || type === 'VP8L' || type === 'VP8X')) fail('corrupt_image');
    if (type === 'VP8X') {
      if (size < 10) fail('corrupt_image');
      if (buf[body] & 0x02) animated = true;
      width = 1 + buf.readUIntLE(body + 4, 3);
      height = 1 + buf.readUIntLE(body + 7, 3);
    } else if (type === 'VP8 ' && width === null) {
      if (size < 10 || buf[body + 3] !== 0x9d || buf[body + 4] !== 0x01 || buf[body + 5] !== 0x2a) fail('corrupt_image');
      width = buf.readUInt16LE(body + 6) & 0x3fff;
      height = buf.readUInt16LE(body + 8) & 0x3fff;
    } else if (type === 'VP8L' && width === null) {
      if (size < 5 || buf[body] !== 0x2f) fail('corrupt_image');
      const bits = buf.readUInt32LE(body + 1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    } else if (type === 'ANIM' || type === 'ANMF') {
      animated = true;
    } else if (type === 'EXIF' && body + size <= buf.length) {
      meta = readTiff(buf, body, body + size);
    }
    i = body + size + (size % 2);
  }
  if (width === null) fail('corrupt_image');
  return imageResult('webp', width, height, meta, animated);
}

// Decides format from bytes only (never the extension or client MIME).
function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) fail('unsupported_image_type');
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return sniffJpeg(buf);
  if (buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) return sniffPng(buf);
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return sniffWebp(buf);
  return fail('unsupported_image_type');
}

function assertImageFacts(facts, bytes) {
  const { image } = LIMITS;
  if (!Number.isInteger(bytes) || bytes <= 0) fail('empty_file', 400);
  if (bytes > image.maxBytes) fail('file_too_large');
  if (facts.animated) fail('animated_image_not_supported', 415);
  if (!(facts.width >= image.minEdge && facts.width <= image.maxEdge && facts.height >= image.minEdge && facts.height <= image.maxEdge)) {
    fail('image_dimensions_out_of_range');
  }
  if (facts.width * facts.height > image.maxPixels) fail('image_too_many_pixels');
  return facts;
}

// ----- Video ------------------------------------------------------------------
const MP4_BRANDS = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'mp71', 'avc1', 'M4V ', 'M4VP', 'dash', 'MSNV']);

function sniffVideoContainer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) fail('unsupported_video_container');
  const head = buf.toString('latin1', 0, Math.min(buf.length, 32)).replace(/^﻿|^\xEF\xBB\xBF/, '').trimStart();
  if (head.startsWith('#EXTM3U') || head.startsWith('<MPD') || head.startsWith('<?xml')) fail('remote_playlist_rejected');
  if (buf.toString('latin1', 4, 8) === 'ftyp') {
    const brand = buf.toString('latin1', 8, 12);
    if (brand === 'qt  ') return { container: 'mov', mime: 'video/quicktime', ext: 'mov' };
    if (MP4_BRANDS.has(brand)) return { container: 'mp4', mime: 'video/mp4', ext: 'mp4' };
    return fail('unsupported_video_container');
  }
  if (buf.readUInt32BE(0) === 0x1a45dfa3) {
    const limit = Math.min(buf.length - 3, 64);
    for (let i = 4; i < limit; i += 1) {
      if (buf[i] === 0x42 && buf[i + 1] === 0x82 && (buf[i + 2] & 0x80)) {
        const length = buf[i + 2] & 0x7f;
        const doctype = buf.toString('latin1', i + 3, i + 3 + length);
        if (doctype === 'webm') return { container: 'webm', mime: 'video/webm', ext: 'webm' };
        return fail('unsupported_video_container');
      }
    }
  }
  return fail('unsupported_video_container');
}

function parseRate(value) {
  if (typeof value !== 'string') return null;
  const [num, den] = value.split('/').map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0 || num <= 0) return null;
  return num / den;
}

function streamRotation(stream) {
  const matrix = (stream.side_data_list || []).find((item) => item && typeof item.rotation === 'number');
  if (matrix) return ((Math.round(-matrix.rotation) % 360) + 360) % 360;
  const tag = Number(stream.tags?.rotate);
  if (Number.isFinite(tag)) return ((Math.round(tag) % 360) + 360) % 360;
  return 0;
}

// Accepts ffprobe -show_format -show_streams JSON and returns oriented facts.
function normalizeProbe(probe, container) {
  const { video } = LIMITS;
  if (!probe || typeof probe !== 'object' || !Array.isArray(probe.streams) || !probe.format) fail('corrupt_video');
  const formatName = String(probe.format.format_name || '');
  const expected = container === 'webm' ? /^matroska,webm$/ : /^mov,mp4/;
  if (!expected.test(formatName)) fail('container_mismatch');
  const videos = probe.streams.filter((s) => s.codec_type === 'video');
  const audios = probe.streams.filter((s) => s.codec_type === 'audio');
  if (probe.streams.some((s) => s.codec_type !== 'video' && s.codec_type !== 'audio')) fail('unsupported_stream');
  if (!videos.length) fail('no_video_stream');
  if (videos.length > 1 || audios.length > 1 || videos.some((s) => s.disposition?.attached_pic)) fail('too_many_streams');
  const stream = videos[0];
  if (!video.codecs.includes(stream.codec_name)) fail('unsupported_video_codec');
  const seconds = Number(probe.format.duration ?? stream.duration);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds * 1000 > video.maxDurationMs) fail('video_duration_out_of_range');
  const rotation = streamRotation(stream);
  const coded = { width: Number(stream.width), height: Number(stream.height) };
  if (!Number.isInteger(coded.width) || !Number.isInteger(coded.height)) fail('corrupt_video');
  const oriented = rotation === 90 || rotation === 270 ? { width: coded.height, height: coded.width } : coded;
  if (!(oriented.width >= video.minEdge && oriented.width <= video.maxEdge && oriented.height >= video.minEdge && oriented.height <= video.maxEdge)) {
    fail('video_dimensions_out_of_range');
  }
  if (oriented.width * oriented.height > video.maxPixels) fail('video_too_many_pixels');
  const fps = parseRate(stream.avg_frame_rate) || parseRate(stream.r_frame_rate);
  if (!fps || fps > video.maxFps + 0.01) fail('video_frame_rate_out_of_range');
  return {
    durationMs: Math.round(seconds * 1000),
    width: oriented.width,
    height: oriented.height,
    fps: Math.round(fps * 100) / 100,
    videoCodec: stream.codec_name,
    hasAudio: audios.length === 1,
    rotation,
  };
}

// ----- Recipe and text --------------------------------------------------------
const TEXT_KEYS = ['alt_text', 'end_frame_alt_text', 'cues', 'transcript', 'caption_language', 'caption_cues', 'instruction_audio'];
const RECIPE_KEYS = ['include_instruction', 'poster_mode', 'poster_frame_ms', 'poster_crop', 'preview_start_ms', 'preview_end_ms', 'preview_crop', 'end_frame_ms', 'end_frame_crop'];
const PATCH_KEYS = new Set([...TEXT_KEYS, ...RECIPE_KEYS]);

function plainString(value, { max, emptyCode, longCode }) {
  if (value === null) return null;
  if (typeof value !== 'string') fail('invalid_text');
  const trimmed = value.trim();
  if (!trimmed) {
    if (emptyCode) fail(emptyCode);
    return null;
  }
  if (trimmed.length > max) fail(longCode);
  return trimmed;
}

function normalizeCues(value) {
  if (!Array.isArray(value)) fail('invalid_cues');
  const cues = value.map((cue) => {
    if (typeof cue !== 'string') fail('invalid_cues');
    return cue.trim();
  }).filter(Boolean);
  if (cues.length > LIMITS.text.cuesMax) fail('too_many_cues');
  if (cues.some((cue) => cue.length > LIMITS.text.cueMax)) fail('cue_too_long');
  return cues;
}

function normalizeCaptionCues(value, durationMs) {
  const { captions } = LIMITS;
  if (!Array.isArray(value) || value.length > captions.maxCues) fail('invalid_caption_cues');
  let previous = -1;
  let total = 0;
  return value.map((cue) => {
    if (!cue || typeof cue !== 'object' || Array.isArray(cue)) fail('invalid_caption_cues');
    const keys = Object.keys(cue).sort().join(',');
    if (keys !== 'end_ms,start_ms,text') fail('invalid_caption_cues');
    const { start_ms: start, end_ms: end } = cue;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > LIMITS.video.maxDurationMs) fail('invalid_caption_cues');
    if (durationMs && end > durationMs) fail('invalid_caption_cues');
    if (start < previous) fail('invalid_caption_cues');
    previous = start;
    if (typeof cue.text !== 'string') fail('invalid_caption_cues');
    const text = cue.text.replace(/\s+/g, ' ').trim();
    if (!text || text.length > captions.maxCueChars) fail('invalid_caption_cues');
    total += text.length;
    if (total > captions.maxTextChars) fail('invalid_caption_cues');
    return { start_ms: start, end_ms: end, text };
  });
}

function validCropShape(crop) {
  if (!crop || typeof crop !== 'object' || Array.isArray(crop)) return false;
  if (Object.keys(crop).sort().join(',') !== 'height,width,x,y') return false;
  const { x, y, width, height } = crop;
  if (![x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
  return x >= 0 && y >= 0 && width > 0 && height > 0 && width <= 1 && height <= 1 && x + width <= 1.000001 && y + height <= 1.000001;
}

function cropMatchesAspect(crop, dims) {
  if (!dims?.width || !dims?.height) return false;
  const ratio = (crop.width * dims.width) / (crop.height * dims.height);
  return Math.abs(ratio / LIMITS.crop.aspect - 1) <= LIMITS.crop.tolerance;
}

function normalizeTime(value, video) {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) fail('invalid_time');
  if (!video) fail('source_video_required');
  if (value >= video.durationMs) fail('time_out_of_range');
  return value;
}

// Validates a coach recipe/text patch against the stored source facts.
// sources: { video?: {durationMs,width,height}, image?: {width,height}, posterMode? }
function normalizeRecipePatch(body, sources = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('invalid_field', 400);
  for (const key of Object.keys(body)) if (!PATCH_KEYS.has(key)) fail('invalid_field', 400);
  const out = {};
  const { text } = LIMITS;
  if ('alt_text' in body) out.alt_text = plainString(body.alt_text, { max: text.altMax, emptyCode: 'alt_text_required', longCode: 'alt_text_too_long' });
  if ('end_frame_alt_text' in body) out.end_frame_alt_text = plainString(body.end_frame_alt_text, { max: text.altMax, emptyCode: 'alt_text_required', longCode: 'alt_text_too_long' });
  if ('cues' in body) out.cues = normalizeCues(body.cues);
  if ('transcript' in body) out.transcript = plainString(body.transcript, { max: text.transcriptMax, longCode: 'transcript_too_long' });
  if ('caption_language' in body) {
    if (body.caption_language !== null && (typeof body.caption_language !== 'string' || !/^[a-z]{2,3}(-[A-Z]{2})?$/.test(body.caption_language))) fail('invalid_caption_language');
    out.caption_language = body.caption_language;
  }
  if ('caption_cues' in body) out.caption_cues = normalizeCaptionCues(body.caption_cues, sources.video?.durationMs);
  for (const flag of ['instruction_audio', 'include_instruction']) {
    if (flag in body) {
      if (typeof body[flag] !== 'boolean') fail('invalid_flag');
      out[flag] = body[flag];
    }
  }
  if ('poster_mode' in body) {
    if (body.poster_mode !== null && !['uploaded_image', 'video_frame'].includes(body.poster_mode)) fail('invalid_poster_mode');
    out.poster_mode = body.poster_mode;
  }
  if ('poster_frame_ms' in body) out.poster_frame_ms = normalizeTime(body.poster_frame_ms, sources.video);
  if ('end_frame_ms' in body) out.end_frame_ms = normalizeTime(body.end_frame_ms, sources.video);
  if ('preview_start_ms' in body || 'preview_end_ms' in body) {
    const start = body.preview_start_ms;
    const end = body.preview_end_ms;
    if (start === null && end === null) {
      out.preview_start_ms = null;
      out.preview_end_ms = null;
    } else {
      if (!('preview_start_ms' in body) || !('preview_end_ms' in body)) fail('invalid_preview_range');
      for (const value of [start, end]) if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) fail('invalid_time');
      const length = end - start;
      if (length < LIMITS.preview.minMs || length > LIMITS.preview.maxMs) fail('invalid_preview_range');
      if (!sources.video) fail('source_video_required');
      if (end > sources.video.durationMs) fail('time_out_of_range');
      out.preview_start_ms = start;
      out.preview_end_ms = end;
    }
  }
  const posterMode = out.poster_mode ?? body.poster_mode ?? sources.posterMode
    ?? (sources.image ? 'uploaded_image' : sources.video ? 'video_frame' : null);
  const cropDims = {
    poster_crop: posterMode === 'uploaded_image' ? sources.image : posterMode === 'video_frame' ? sources.video : null,
    end_frame_crop: sources.video,
    preview_crop: sources.video,
  };
  for (const key of ['poster_crop', 'end_frame_crop', 'preview_crop']) {
    if (!(key in body)) continue;
    const crop = body[key];
    if (crop === null) { out[key] = null; continue; }
    if (!validCropShape(crop)) fail('invalid_crop');
    const dims = cropDims[key];
    if (!dims) fail(key === 'poster_crop' && posterMode === 'uploaded_image' ? 'source_image_required' : 'source_video_required');
    if (!cropMatchesAspect(crop, dims)) fail('crop_aspect_mismatch');
    out[key] = { x: crop.x, y: crop.y, width: crop.width, height: crop.height };
  }
  return out;
}

// ----- Captions ---------------------------------------------------------------
function vttTime(ms) {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(millis, 3)}`;
}

function escapeVtt(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function captionsToWebVtt(cues, language) {
  const normalized = normalizeCaptionCues(cues);
  const header = typeof language === 'string' && /^[a-z]{2,3}(-[A-Z]{2})?$/.test(language) ? `WEBVTT\nLanguage: ${language}\n` : 'WEBVTT\n';
  const body = normalized.map((cue, index) => `\n${index + 1}\n${vttTime(cue.start_ms)} --> ${vttTime(cue.end_ms)}\n${escapeVtt(cue.text)}\n`).join('');
  const vtt = header + body;
  if (Buffer.byteLength(vtt) > LIMITS.captions.maxVttBytes) fail('invalid_caption_cues');
  return vtt;
}

// ----- Names and ranges -------------------------------------------------------
// Display only; storage addressing never uses the client's name.
function sanitizeDisplayName(name) {
  if (typeof name !== 'string') return null;
  const base = name.split(/[\\/]/).pop() || '';
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '')
    .replace(/[^\p{L}\p{N} ._()-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LIMITS.text.displayNameMax);
  return cleaned || null;
}

// One "bytes=" range only. Multi-range or other units are ignored (full 200).
function parseRange(header, size) {
  if (typeof header !== 'string') return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!suffix || !size) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start >= size || end < start) return 'unsatisfiable';
  return { start, end };
}

module.exports = {
  LIMITS,
  MediaError,
  isUuid,
  sniffImage,
  assertImageFacts,
  sniffVideoContainer,
  normalizeProbe,
  normalizeRecipePatch,
  normalizeCaptionCues,
  captionsToWebVtt,
  cropMatchesAspect,
  validCropShape,
  sanitizeDisplayName,
  parseRange,
  TEXT_KEYS,
  RECIPE_KEYS,
};
