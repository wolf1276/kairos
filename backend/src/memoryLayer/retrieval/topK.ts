// Top-K Selector — a pure slice over an already-ranked array. Ranking order is preserved, so
// selection introduces no additional non-determinism.
export const DEFAULT_TOP_K_EPISODIC = 10;
export const DEFAULT_TOP_K_SEMANTIC = 10;
export const DEFAULT_TOP_K_WORKING = 5;

export function selectTopK<T>(ranked: readonly T[], k: number): T[] {
  const limit = Number.isFinite(k) && k >= 0 ? Math.floor(k) : 0;
  return ranked.slice(0, limit);
}
