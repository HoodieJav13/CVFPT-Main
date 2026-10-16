// Exercise demo references (docs/exercise-guides/design.md). Pure browser
// helpers: strict YouTube single-video parsing, live current-demo resolution
// and the fixed privacy-enhanced embed URL. An independent server copy lives
// at backend/src/lib/exerciseDemo.js (separate deploy roots, never imported
// across); backend/test/exercise-demo.test.js holds both to the same vectors.
//
// Syntactic validity proves nothing about ownership or availability. Nothing
// here contacts YouTube; the player loads only after a deliberate action.

const MAX_LENGTH = 2048;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const WATCH_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const SHORT_HOST = 'youtu.be';
const UNSAFE_CHARS = /[\s\u0000-\u001f\u007f<>"'`\\]/;

export const YOUTUBE_EMBED_ORIGIN = 'https://www.youtube-nocookie.com';
export const DEMO_SOURCES = ['library', 'override', 'legacy'];

function parsedHttpUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_LENGTH || UNSAFE_CHARS.test(trimmed)) return null;
  let url;
  try { url = new URL(trimmed); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  return url;
}

export function parseYouTubeDemo(value) {
  const url = parsedHttpUrl(value);
  if (!url || url.protocol !== 'https:' || url.port !== '') return null;
  const host = url.hostname.toLowerCase();
  let id = null;
  if (WATCH_HOSTS.has(host)) {
    if (url.pathname === '/watch') {
      const ids = url.searchParams.getAll('v');
      if (ids.length === 1) id = ids[0];
    } else {
      const match = /^\/(?:shorts|embed)\/([^/]+)\/?$/.exec(url.pathname);
      if (match) id = match[1];
    }
  } else if (host === SHORT_HOST) {
    const match = /^\/([^/]+)\/?$/.exec(url.pathname);
    if (match) id = match[1];
  }
  if (!id || !YOUTUBE_ID.test(id)) return null;
  return { videoId: id, watchUrl: `https://www.youtube.com/watch?v=${id}` };
}

function demoFor(candidate, source) {
  const url = parsedHttpUrl(candidate);
  if (!url) return null;
  const youtube = parseYouTubeDemo(candidate);
  if (youtube) return { kind: 'youtube', url: youtube.watchUrl, video_id: youtube.videoId, source, current_guide: true };
  return { kind: 'external', url: url.href, source, current_guide: true };
}

const blank = (value) => value === null || value === undefined || (typeof value === 'string' && !value.trim());

function chooseDemoReference({ workoutExercise, libraryExercise }) {
  const mode = workoutExercise ? workoutExercise.video_link_mode : undefined;
  const libraryUrl = libraryExercise ? libraryExercise.video_url : null;
  if (mode === 'inherit') return { source: 'library', candidate: libraryUrl };
  if (mode === 'override') return { source: 'override', candidate: workoutExercise.video_url };
  const rowUrl = workoutExercise ? workoutExercise.video_url : null;
  if (!blank(rowUrl) && parsedHttpUrl(rowUrl)) return { source: 'legacy', candidate: rowUrl };
  return { source: 'library', candidate: libraryUrl };
}

export function resolveExerciseDemo({ workoutExercise = null, libraryExercise = null } = {}) {
  const { source, candidate } = chooseDemoReference({ workoutExercise, libraryExercise });
  return demoFor(candidate, source);
}

// Backward-compatible resolved `video_url` (same choice as the DTO, as the
// stored safe string or null) for existing consumers and the preview mock.
export function resolvedVideoUrl({ workoutExercise = null, libraryExercise = null } = {}) {
  const { candidate } = chooseDemoReference({ workoutExercise, libraryExercise });
  const url = parsedHttpUrl(candidate);
  return url ? url.toString() : null;
}

// A server-supplied DemoDTO is re-derived from its URL before any use, so a
// tampered kind or video_id can never become an embed.
export function trustedDemo(demo) {
  if (!demo || typeof demo !== 'object') return null;
  const source = DEMO_SOURCES.includes(demo.source) ? demo.source : 'library';
  return demoFor(demo.url, source);
}

// The current demo for a rendered row: the server DTO when present, otherwise
// (an API without `demo`) the row's backward-compatible resolved video_url.
export function demoForRow(row) {
  if (!row) return null;
  if (row.demo) return trustedDemo(row.demo);
  return resolveExerciseDemo({ workoutExercise: { video_url: row.video_url }, libraryExercise: row.library_exercise || null });
}

// Fixed privacy-enhanced embed for an already-validated id. Only the app
// origin (never a path, workout, client or token) is passed, as the IFrame API
// requires for its postMessage channel.
export function youtubeEmbedUrl(videoId, { origin = null, autoplay = true } = {}) {
  if (typeof videoId !== 'string' || !YOUTUBE_ID.test(videoId)) return null;
  const params = new URLSearchParams({ playsinline: '1', rel: '0', cc_load_policy: '1', enablejsapi: '1' });
  if (autoplay) params.set('autoplay', '1');
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') params.set('origin', parsed.origin);
    } catch { /* no origin parameter */ }
  }
  return `${YOUTUBE_EMBED_ORIGIN}/embed/${videoId}?${params.toString()}`;
}
