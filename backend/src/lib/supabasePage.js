// PostgREST caps every response at `max_rows` (1000, see supabase/config.toml).
// A plain `.limit(n)` above that silently returns a short page, so any
// aggregate built on one is quietly incomplete — and a truncation flag
// derived from the row count never fires.
//
// fetchAllRows pages with .range() until a short page arrives, so callers
// get the complete set or a thrown error. The safety ceiling exists only to
// stop a runaway loop; when it trips the caller is told, never silently
// handed a partial answer.
const PAGE_SIZE = 1000;
const MAX_PAGES = 50; // 50k rows — far beyond a three-coach studio

/**
 * @param {(from: number, to: number) => PromiseLike<{data: any[], error: any}>} pageQuery
 *   Builds a fresh query for one inclusive .range() window. It must build a
 *   NEW query each call — PostgREST builders are not reusable.
 */
async function fetchAllRows(pageQuery) {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const start = page * PAGE_SIZE;
    const { data, error } = await pageQuery(start, start + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return { rows, complete: true };
  }
  return { rows, complete: false };
}

module.exports = { fetchAllRows, PAGE_SIZE, MAX_PAGES };
