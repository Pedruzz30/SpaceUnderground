// PostgREST answers every request with at most the project's max_rows (1000 by
// default on Supabase) and reports no error when it cuts the rest: a plain
// select of a bigger table silently returns a partial list. The ledger and the
// pipeline are summed on screen, so a cut list would print wrong totals. Their
// full reads page instead, until they hold the count the first page reports.

export const PAGE_SIZE = 1000;

// buildQuery(withCount) returns a fresh, ordered select; only the first page
// asks for the exact count. The order must be total (end on a unique column),
// or rows could move between pages.
export async function selectAll(buildQuery, { pageSize = PAGE_SIZE } = {}) {
  const rows = [];
  let total = null;
  for (;;) {
    const from = rows.length;
    const result = await buildQuery(total === null).range(from, from + pageSize - 1);
    if (result.error) return { data: null, error: result.error };
    const page = result.data ?? [];
    if (total === null) total = Number.isInteger(result.count) ? result.count : null;
    rows.push(...page);
    // A server capped below pageSize answers short pages, so a short page only
    // ends the read when no count came back.
    const done = !page.length || (total !== null ? rows.length >= total : page.length < pageSize);
    if (done) return { data: rows, error: null };
  }
}
