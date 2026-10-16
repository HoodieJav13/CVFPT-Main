// Optional still selection from a clip on the coach's own device
// (docs/exercise-guides/design.md). The clip is decoded locally (blob URL +
// <video>), one frame is drawn to a canvas, and ONLY that image is uploaded
// through the ordinary photo pipeline, which re-verifies it on the server. The
// original clip is never uploaded or backed up, and nothing here claims
// server-verified frame provenance. A confirmed still is bound to its exact
// source file and time; any change invalidates it.

const MiB = 1024 * 1024;
export const STILL_LIMITS = Object.freeze({ maxLongEdge: 1920, minEdge: 160, maxBytes: 10 * MiB, types: ['image/jpeg', 'image/png', 'image/webp'], quality: 0.9 });

// Downscale to a useful long edge; never upscale; refuse below the server's minimum edge.
export function stillDimensions(width, height) {
  if (!(width > 0 && height > 0)) return null;
  const scale = Math.min(1, STILL_LIMITS.maxLongEdge / Math.max(width, height));
  const out = { width: Math.round(width * scale), height: Math.round(height * scale) };
  if (Math.min(out.width, out.height) < STILL_LIMITS.minEdge) return null;
  return out;
}

export function sourceKey(file) {
  return `${file?.name}|${file?.size}|${file?.lastModified}`;
}

export function confirmationIsCurrent(confirmed, { file, timeMs }) {
  return Boolean(confirmed && file && confirmed.key === sourceKey(file) && confirmed.timeMs === timeMs);
}

export function checkStillBlob(blob) {
  if (!blob || !blob.size) return { code: 'empty', message: 'The still could not be exported. Try another frame or upload a photo.' };
  if (!STILL_LIMITS.types.includes(blob.type)) return { code: 'unsupported_type', message: 'This browser exported an unsupported image type. Upload a photo instead.' };
  if (blob.size > STILL_LIMITS.maxBytes) return { code: 'too_large', message: 'The still is larger than 10 MB. Choose another frame or upload a photo.' };
  return null;
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function stillFileName(timeMs, type, sourceName) {
  const safe = Math.max(0, Math.round(timeMs || 0));
  const minutes = Math.floor(safe / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1000);
  const tenths = Math.floor((safe % 1000) / 100);
  const base = String(sourceName || 'clip').split(/[\\/]/).pop().replace(/\.[^.]*$/, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'clip';
  return `still-${minutes}m${String(seconds).padStart(2, '0')}.${tenths}s-${base}.${EXT[type] || 'jpg'}`;
}

// Browser-only: waits for an exact seek to complete.
export function seekVideo(video, timeMs) {
  return new Promise((resolve, reject) => {
    const target = Math.max(0, timeMs / 1000);
    if (!video.seeking && Math.abs(video.currentTime - target) < 0.001 && video.readyState >= 2) { resolve(); return; }
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('seek_failed')); };
    const cleanup = () => { video.removeEventListener('seeked', done); video.removeEventListener('error', fail); };
    video.addEventListener('seeked', done, { once: true });
    video.addEventListener('error', fail, { once: true });
    video.currentTime = target;
  });
}

// Browser-only: draws the current frame, downscaled, and exports an image Blob.
export async function exportStill(video) {
  const size = stillDimensions(video.videoWidth, video.videoHeight);
  if (!size) throw Object.assign(new Error('too_small'), { code: 'too_small' });
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const g = canvas.getContext('2d');
  g.drawImage(video, 0, 0, size.width, size.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', STILL_LIMITS.quality));
  canvas.width = 0; canvas.height = 0;
  return { blob, ...size };
}
