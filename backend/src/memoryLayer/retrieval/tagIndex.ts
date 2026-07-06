// A retrieval-time-only tag index built over an already-fetched record list. Does not touch
// Phase 1 provider storage — providers stay list()-only — but avoids re-scanning the full list
// once per query tag by grouping records by tag a single pass, then unioning the small buckets
// that match the query.

/** A corrupted provider or a hand-rolled test double can hand back a record whose `tags` isn't
 *  an array (missing/null/wrong type) — this must degrade to "no tags", never throw, so one
 *  malformed record can't take down retrieval for an agent's entire memory set. */
function safeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags.filter((t): t is string => typeof t === 'string');
}

export function buildTagIndex<T extends { tags: readonly string[] }>(records: readonly T[]): Map<string, T[]> {
  const index = new Map<string, T[]>();
  for (const record of records) {
    for (const rawTag of safeTags(record.tags)) {
      const tag = rawTag.trim().toLowerCase();
      if (!tag) continue;
      const bucket = index.get(tag);
      if (bucket) bucket.push(record);
      else index.set(tag, [record]);
    }
  }
  return index;
}

/** Union of every record whose tags intersect queryTags, order-preserving relative to the
 *  original list and de-duplicated by reference. Falls back to the full record list when
 *  queryTags is empty — an empty query matches nothing to filter on, not nothing at all. */
export function filterCandidatesByTags<T extends { tags: readonly string[] }>(
  records: readonly T[],
  index: Map<string, T[]>,
  queryTags: readonly string[]
): T[] {
  if (queryTags.length === 0) return [...records];
  const matched = new Set<T>();
  for (const tag of queryTags) {
    const bucket = index.get(tag);
    if (!bucket) continue;
    for (const record of bucket) matched.add(record);
  }
  // Preserve original list order for determinism regardless of Set/Map iteration order.
  return records.filter((r) => matched.has(r));
}
