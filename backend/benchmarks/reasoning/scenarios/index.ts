// Public surface of the benchmark scenario library. Bump SCENARIO_SET_VERSION whenever a
// scenario is added or removed (not for in-place edits — each scenario tracks its own `version`
// for that). Comparing two benchmark reports across different SCENARIO_SET_VERSIONs is not
// apples-to-apples; the regression tracker (metrics/regression.ts) flags this.
import { marketScenarios } from './marketScenarios.js';
import { memoryScenarios } from './memoryScenarios.js';
import { policyScenarios } from './policyScenarios.js';
import { portfolioScenarios } from './portfolioScenarios.js';
import type { BenchmarkScenario } from './types.js';

export const SCENARIO_SET_VERSION = '1.0.0';

export const ALL_SCENARIOS: BenchmarkScenario[] = [
  ...marketScenarios,
  ...memoryScenarios,
  ...policyScenarios,
  ...portfolioScenarios,
];

export function getScenarioById(id: string): BenchmarkScenario | undefined {
  return ALL_SCENARIOS.find((s) => s.id === id);
}

export function getScenariosByCategory(category: string): BenchmarkScenario[] {
  return ALL_SCENARIOS.filter((s) => s.category === category);
}

export type { BenchmarkScenario, ScenarioCategory } from './types.js';
