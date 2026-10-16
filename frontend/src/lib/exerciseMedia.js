// Browser helpers for exercise media: early checks that mirror the server's
// limits (the server stays authoritative), keyboard-friendly 16:9 crop math,
// time selection, and an actor-scoped, in-memory link cache. Links are never
// persisted (no localStorage, outbox or service-worker cache).
// Keep MEDIA_LIMITS in sync with backend/src/lib/exerciseMedia/validation.js;
// backend/test/exercise-media-limits-parity.test.js checks parity.

const MiB = 1024 * 1024;

export const MEDIA_LIMITS = Object.freeze({
  image: Object.freeze({ maxBytes: 10 * MiB, minEdge: 160, maxEdge: 8192, mimes: ['image/jpeg', 'image/png', 'image/webp'] }),
  video: Object.freeze({ maxBytes: 100 * MiB, maxDurationMs: 120_000, mimes: ['video/mp4', 'video/quicktime', 'video/webm'] }),
  preview: Object.freeze({ minMs: 1000, maxMs: 8000 }),
  text: Object.freeze({ altMax: 240, cueMax: 160, cuesMax: 3, transcriptMax: 12_000, rightsNoteMax: 1000 }),
  crop: Object.freeze({ aspect: 16 / 9, tolerance: 0.01, minSourceWidth: 160 }),
  links: Object.freeze({ maxAssets: 20 }),
});

const EXTENSIONS = {
  source_image: ['jpg', 'jpeg', 'png', 'webp'],
  source_video: ['mp4', 'mov', 'm4v', 'webm'],
};

// Cheap early feedback only; the server sniffs bytes and decides.
export function checkFileBeforeUpload(file, role) {
  if (!file) return { code: 'file_required', message: 'Choose a file first.' };
  const limits = role === 'source_image' ? MEDIA_LIMITS.image : MEDIA_LIMITS.video;
  if (!file.size) return { code: 'empty_file', message: 'That file is empty.' };
  if (file.size > limits.maxBytes) {
    return { code: 'file_too_large', message: `That file is larger than ${Math.round(limits.maxBytes / MiB)} MB.` };
  }
  const extension = String(file.name || '').split('.').pop().toLowerCase();
  const typeOk = file.type ? limits.mimes.includes(file.type) : EXTENSIONS[role].includes(extension);
  if (!typeOk) {
    return {
      code: 'unsupported_type',
      message: role === 'source_image' ? 'Use a JPEG, PNG or still WebP image.' : 'Use an MP4, MOV or WebM video.',
    };
  }
  return null;
}

// ----- 16:9 crop in normalized oriented coordinates -------------------------
const ASPECT = MEDIA_LIMITS.crop.aspect;
const round = (value) => Math.round(value * 1e6) / 1e6;

// Largest centered 16:9 crop for the given oriented pixel size.
export function defaultCrop(dims) {
  if (!dims?.width || !dims?.height) return { x: 0, y: 0, width: 1, height: 1 };
  if (dims.width / dims.height >= ASPECT) {
    const width = (dims.height * ASPECT) / dims.width;
    return { x: (1 - width) / 2, y: 0, width, height: 1 };
  }
  const height = (dims.width / ASPECT) / dims.height;
  return { x: 0, y: (1 - height) / 2, width: 1, height };
}

export function cropAspectOk(crop, dims) {
  if (!crop || !dims?.width || !dims?.height) return false;
  const ratio = (crop.width * dims.width) / (crop.height * dims.height);
  return Math.abs(ratio / ASPECT - 1) <= MEDIA_LIMITS.crop.tolerance;
}

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

// Moves by fractions of the crop size (keyboard arrows), staying in bounds.
export function moveCrop(crop, dxSteps, dySteps, step = 0.1) {
  const x = clamp(crop.x + dxSteps * crop.width * step, 0, 1 - crop.width);
  const y = clamp(crop.y + dySteps * crop.height * step, 0, 1 - crop.height);
  return { ...crop, x: round(x), y: round(y) };
}

// factor < 1 zooms in, > 1 zooms out; keeps the center and the 16:9 shape,
// never smaller than a usable source area or larger than the fitting crop.
export function zoomCrop(crop, dims, factor) {
  const max = defaultCrop(dims);
  const minWidth = Math.min(max.width, MEDIA_LIMITS.crop.minSourceWidth / dims.width);
  const width = clamp(crop.width * factor, minWidth, max.width);
  const height = (width * dims.width) / ASPECT / dims.height;
  if (width >= max.width - 1e-9) return max;
  const cx = crop.x + crop.width / 2;
  const cy = crop.y + crop.height / 2;
  return {
    x: round(clamp(cx - width / 2, 0, 1 - width)),
    y: round(clamp(cy - height / 2, 0, 1 - height)),
    width: round(width),
    height: round(height),
  };
}

// ----- Time selection -----------------------------------------------------------
export function clampTime(ms, durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  const value = Number.isFinite(ms) ? Math.round(ms) : (ms > 0 ? durationMs : 0);
  return clamp(value, 0, durationMs - 1);
}

// Preview is [start, end): start inclusive, end exclusive; end may equal duration.
export function validatePreview(startMs, endMs, durationMs) {
  if (![startMs, endMs].every((value) => typeof value === 'number' && Number.isInteger(value) && value >= 0)) return 'invalid_time';
  const length = endMs - startMs;
  if (length < MEDIA_LIMITS.preview.minMs || length > MEDIA_LIMITS.preview.maxMs) return 'invalid_preview_range';
  if (endMs > durationMs) return 'time_out_of_range';
  return null;
}

export function formatMs(ms) {
  const safe = Math.max(0, Math.round(ms || 0));
  const minutes = Math.floor(safe / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  const tenths = Math.floor((safe % 1000) / 100);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

// ----- Links ------------------------------------------------------------------
export function actorKey(user) {
  return user?.role && user?.profile?.id ? `${user.role}:${user.profile.id}` : null;
}

// Capability paths are API-relative; only that exact shape becomes a URL.
export function absoluteMediaUrl(pathname, apiBaseUrl) {
  if (typeof pathname !== 'string' || !/^\/api\/exercise-media\/content\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(pathname)) return null;
  const base = String(apiBaseUrl || '').replace(/\/api\/?$/, '');
  return `${base}${pathname}`;
}

const contextKey = (context) => (context?.type === 'library' ? `library:${context.exercise_id}` : `${context?.type}:${context?.id}`);

// request(context, assetIds) -> { links: [{asset_id,url,expires_at}], missing }
// Capability links expire (60 s, 300 s for sources). A media element that fails
// asks for one fresh link per successful load; a second failure is real.
export function createRefreshGate(max = 1) {
  let used = 0;
  return {
    onError() { if (used < max) { used += 1; return 'refresh'; } return 'failed'; },
    onLoaded() { used = 0; },
    reset() { used = 0; },
  };
}

export function createLinkCache({ request, now = () => Date.now(), marginMs = 10_000 }) {
  const entries = new Map();   // key -> { url, expiresAt }
  const inflight = new Map();  // key -> Promise<url|null>
  const keyOf = (actor, context, assetId) => `${actor}|${contextKey(context)}|${assetId}`;

  function get({ actor, context, assetIds }) {
    const unique = [...new Set(assetIds.filter(Boolean))];
    if (unique.length > MEDIA_LIMITS.links.maxAssets) throw new Error('At most 20 media links per request');
    const result = new Map();
    const waits = [];
    const needed = [];
    for (const assetId of unique) {
      const key = keyOf(actor, context, assetId);
      const entry = entries.get(key);
      if (entry && entry.expiresAt - marginMs > now()) { result.set(assetId, entry.url); continue; }
      if (inflight.has(key)) { waits.push(inflight.get(key).then((url) => { if (url) result.set(assetId, url); })); continue; }
      needed.push(assetId);
    }
    if (needed.length) {
      // A batch is shared by every waiter, so it is never bound to one
      // caller's AbortSignal; callers that went away simply ignore it.
      const batch = Promise.resolve().then(() => request(context, needed));
      for (const assetId of needed) {
        const key = keyOf(actor, context, assetId);
        const one = batch.then((response) => {
          const link = (response?.links || []).find((item) => item.asset_id === assetId);
          if (!link) return null;
          entries.set(key, { url: link.url, expiresAt: Date.parse(link.expires_at) });
          return link.url;
        }).finally(() => inflight.delete(key));
        inflight.set(key, one);
        waits.push(one.then((url) => { if (url) result.set(assetId, url); }));
      }
    }
    return Promise.all(waits).then(() => result);
  }

  return {
    get,
    invalidate(actor, context, assetId) { entries.delete(keyOf(actor, context, assetId)); },
    clear() { entries.clear(); inflight.clear(); },
    size() { return entries.size; },
  };
}

// Only the active exercise plus the next exercise that has media may load a
// poster; everything else stays text until it becomes active.
export function nextPosterTargets(exercises, activeId) {
  const rows = exercises || [];
  const start = Math.max(0, rows.findIndex((row) => row.id === activeId));
  const targets = new Set();
  if (rows[start]?.media) targets.add(rows[start].id);
  const next = rows.slice(start + 1).find((row) => row.media);
  if (next) targets.add(next.id);
  return targets;
}

export function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

export function prefersDataSaver() {
  try { return Boolean(navigator.connection?.saveData); } catch { return false; }
}

export const MEDIA_KIND_LABELS = { photo: 'Photo', frames: 'Start and end stills', video: 'Movement preview' };
