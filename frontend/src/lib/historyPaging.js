// Pure helpers for paged workout history (unit-tested without the app's
// import aliases). The React hook lives in useHistoryPages.js.

export const HISTORY_PAGE_SIZE = 12;

/** Append a fetched page, skipping any log already listed. */
export function appendHistoryPage(existing, incoming) {
  const seen = new Set(existing.map((log) => log.id));
  return [...existing, ...incoming.filter((log) => !seen.has(log.id))];
}
