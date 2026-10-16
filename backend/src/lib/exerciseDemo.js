// Exercise demo references (docs/exercise-guides/design.md). Pure helpers:
// strict YouTube single-video parsing and live current-demo resolution for a
// workout exercise. An independent browser copy lives at
// frontend/src/lib/exerciseDemo.js (separate deploy roots, never imported
// across); backend/test/exercise-demo.test.js holds both to the same vectors.
//
// Syntactic validity proves nothing about ownership or availability: a parsed
// YouTube id may be private, removed or embedding-disabled. Nothing here
// fetches a URL. Unlisted YouTube is shareable by anyone with the link; it is
// never a substitute for CVF-private media.

const MAX_LENGTH = 2048;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const WATCH_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const SHORT_HOST = 'youtu.be';
// Whitespace/controls (the URL parser silently strips tabs/newlines), quotes,
// angle brackets and backslashes never appear in a pasted single-video link.
const UNSAFE_CHARS = /[\s\u0000-\u001f\u007f<>"'`\\]/;
const YOUTUBE_EMBED_ORIGIN = 'https://www.youtube-nocookie.com';
const DEMO_SOURCES = ['library', 'override', 'legacy'];

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

// -> { videoId, watchUrl } for an HTTPS youtube.com/www/m watch?v=, youtu.be/<id>,
// /shorts/<id> or /embed/<id> link with exactly one valid id; otherwise null.
// Every other parameter (list, t, si, feature, start) is dropped.
function parseYouTubeDemo(value) {
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

// The row's explicit mode decides; NULL/absent is unclassified legacy and keeps
// the original precedence (a nonempty safe workout link, else the library).
// Returns { source, candidate } without validating the chosen value.
function chooseDemoReference({ workoutExercise, libraryExercise }) {
  const mode = workoutExercise ? workoutExercise.video_link_mode : undefined;
  const libraryUrl = libraryExercise ? libraryExercise.video_url : null;
  if (mode === 'inherit') return { source: 'library', candidate: libraryUrl };
  if (mode === 'override') return { source: 'override', candidate: workoutExercise.video_url };
  const rowUrl = workoutExercise ? workoutExercise.video_url : null;
  if (!blank(rowUrl) && parsedHttpUrl(rowUrl)) return { source: 'legacy', candidate: rowUrl };
  return { source: 'library', candidate: libraryUrl };
}

// DemoDTO: {kind:'youtube'|'external', url, video_id?, source:'library'|'override'|'legacy',
// current_guide:true} or null. Derived only by parsing stored URLs; a supplied
// kind/video_id is never trusted. Contains no storage keys, rights notes or
// client metadata.
function resolveExerciseDemo({ workoutExercise = null, libraryExercise = null } = {}) {
  const { source, candidate } = chooseDemoReference({ workoutExercise, libraryExercise });
  return demoFor(candidate, source);
}

// Backward-compatible resolved `video_url` for existing consumers: the same
// choice as the DTO, as the stored safe string (or null).
function resolvedVideoUrl({ workoutExercise = null, libraryExercise = null } = {}) {
  const { candidate } = chooseDemoReference({ workoutExercise, libraryExercise });
  const url = parsedHttpUrl(candidate);
  return url ? url.toString() : null;
}

module.exports = {
  DEMO_SOURCES,
  YOUTUBE_EMBED_ORIGIN,
  parseYouTubeDemo,
  resolveExerciseDemo,
  resolvedVideoUrl,
};
