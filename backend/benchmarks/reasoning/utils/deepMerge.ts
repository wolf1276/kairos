// Generic deep-merge helper shared by scenario fixtures. Arrays are replaced wholesale (never
// concatenated) so a scenario patch can e.g. fully replace `episodic` with an empty array.
export function deepMerge<T>(base: T, patch: unknown): T {
  if (Array.isArray(patch)) return patch as unknown as T;
  if (patch && typeof patch === 'object') {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const key of Object.keys(patch as Record<string, unknown>)) {
      out[key] = deepMerge((base as Record<string, unknown>)?.[key], (patch as Record<string, unknown>)[key]);
    }
    return out as T;
  }
  return patch === undefined ? base : (patch as T);
}
