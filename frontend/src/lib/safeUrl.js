// Only http(s) URLs may render as hrefs. Coach-authored video links can
// arrive via CSV/paste/PDF import, so scheme-check before rendering.
export function safeHttpUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}
