// External video links (e.g. a coach's YouTube link) stay optional resources
// that open in a new tab. New writes must be plain http(s) URLs; existing
// stored values are never rewritten, and re-saving an unchanged legacy value
// is allowed. Rendering independently re-checks with safeHttpUrl/safeVideoUrl.
// A generic link never becomes an iframe: only a strictly parsed YouTube
// single-video link (lib/exerciseDemo.js) may be embedded, by the browser, at
// the fixed privacy-enhanced origin after a deliberate action. No oEmbed,
// server fetch, thumbnail scraping, download or frame extraction.
const MAX_LENGTH = 2048;

function isSafeExternalVideoUrl(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_LENGTH) return false;
  let url;
  try { url = new URL(trimmed); } catch { return false; }
  return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password;
}

const isEmpty = (value) => value === null || value === undefined || (typeof value === 'string' && !value.trim());

// rows: [{ id?, video_url }]; previous: Map(id -> stored video_url).
// Returns indexes of rows carrying a NEW unsafe value.
function unsafeExternalVideoUrls(rows, previous = new Map()) {
  const bad = [];
  (Array.isArray(rows) ? rows : []).forEach((row, index) => {
    const value = row?.video_url;
    if (isEmpty(value) || isSafeExternalVideoUrl(value)) return;
    if (row?.id && previous.has(row.id) && previous.get(row.id) === value) return;
    bad.push(index);
  });
  return bad;
}

const UNSAFE_MESSAGE = 'External video links must be http(s) URLs.';

// Workout exercise demo references (docs/exercise-guides/design.md). A row that
// carries `video_link_mode` is a NEW-shape write and must be internally
// consistent: 'inherit' follows the library exercise live and stores no copied
// URL; 'override' stores an explicit safe URL; null is unclassified legacy and
// is accepted only with no link or when re-saving a legacy row unchanged.
// Rows WITHOUT the key are old request shapes and pass through untouched (the
// shared SQL writer keeps their legacy semantics). Never inferred from URL
// equality with a library link.
const MODE_MESSAGES = {
  invalid: 'Choose the library demo or a custom link for each exercise.',
  inheritCustom: 'Only a library exercise can use the library demo.',
  inheritUrl: 'Use the library demo or a custom link, not both.',
  overrideUrl: 'Add a valid http(s) link, or choose the library demo.',
  legacyEdited: 'Choose the library demo or a custom link for the edited demo link.',
};

function modeError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

// rows: workout exercise rows; previous: Map(id -> stored row). Returns new rows
// (normalized URLs) or throws a 400 error.
function normalizeDemoModes(rows, previous = new Map()) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) => {
    if (!row || typeof row !== 'object' || !Object.hasOwn(row, 'video_link_mode')) return row;
    const mode = row.video_link_mode;
    const url = isEmpty(row.video_url) ? null : row.video_url;
    if (mode === 'inherit') {
      if (isEmpty(row.exercise_library_id)) throw modeError(MODE_MESSAGES.inheritCustom);
      if (url !== null) throw modeError(MODE_MESSAGES.inheritUrl);
      return { ...row, video_url: null };
    }
    if (mode === 'override') {
      if (url === null || !isSafeExternalVideoUrl(url)) throw modeError(MODE_MESSAGES.overrideUrl);
      return { ...row, video_url: url.trim() };
    }
    if (mode === null) {
      if (url === null) return { ...row, video_url: null };
      const stored = row.id ? previous.get(row.id) : null;
      if (stored && (stored.video_link_mode ?? null) === null && stored.video_url === row.video_url) return row;
      throw modeError(MODE_MESSAGES.legacyEdited);
    }
    throw modeError(MODE_MESSAGES.invalid);
  });
}

module.exports = { isSafeExternalVideoUrl, unsafeExternalVideoUrls, normalizeDemoModes, UNSAFE_MESSAGE };
