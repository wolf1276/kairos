/** Filesystem-safe UTC timestamp for report filenames — sortable lexicographically, unique per
 *  second, so concurrent runs never collide and reports never overwrite each other. */
export function reportTimestamp(date: Date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}
