// External video links (e.g. a coach's YouTube link) stay optional resources
// that open in a new tab. New writes must be plain http(s) URLs; existing
// stored values are never rewritten, and re-saving an unchanged legacy value
// is allowed. Rendering independently re-checks with safeHttpUrl/safeVideoUrl.
// No iframe, oEmbed, thumbnail scraping, download or frame extraction.
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

module.exports = { isSafeExternalVideoUrl, unsafeExternalVideoUrls, UNSAFE_MESSAGE };
