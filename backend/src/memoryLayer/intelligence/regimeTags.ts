// Canonical, closed market-regime vocabulary shared by the statistics, pattern, and evidence
// engines so the regime frequency table and regime-pattern detection can never drift apart.
// Single source of truth — mirrors ExtendedRegimeLabel in agentContext/regimeDetector.ts.
import type { ExtendedRegimeLabel } from '../../agentContext/regimeDetector.js';

export const REGIME_TAGS: readonly ExtendedRegimeLabel[] = [
  'trending_up',
  'trending_down',
  'ranging',
  'breakout_up',
  'breakout_down',
  'high_volatility',
  'low_volatility',
];

export const REGIME_TAG_SET: ReadonlySet<string> = new Set(REGIME_TAGS);
