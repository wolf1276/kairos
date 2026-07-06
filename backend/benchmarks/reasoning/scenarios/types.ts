// Scenario contract for the Reasoning Benchmark Framework. A scenario is pure data — an
// AgentContext + MemoryPackage + UserPolicy triple plus metadata — never a modification of the
// Context/Memory/Reasoning engines it's built from.
import type { AgentContext } from '../../../src/agentContext/index.js';
import type { MemoryPackage } from '../../../src/memoryLayer/index.js';
import type { UserPolicy } from '../../../src/reasoning/types.js';

export type ScenarioCategory =
  | 'bull'
  | 'bear'
  | 'sideways'
  | 'high_volatility'
  | 'low_volatility'
  | 'empty_memory'
  | 'rich_memory'
  | 'conflicting_evidence'
  | 'conservative_policy'
  | 'balanced_policy'
  | 'aggressive_policy'
  | 'small_portfolio'
  | 'large_portfolio';

/** Scenarios are versioned individually — bump a scenario's `version` whenever its fixture data
 *  changes in a way that would make historical benchmark reports non-comparable to new ones run
 *  against the updated scenario. See scenarios/index.ts::SCENARIO_SET_VERSION for the version of
 *  the whole set (bumped when a scenario is added/removed, not just edited). */
export interface BenchmarkScenario {
  id: string;
  name: string;
  category: ScenarioCategory;
  version: string;
  description: string;
  agentContext: AgentContext;
  memoryPackage: MemoryPackage;
  userPolicy: UserPolicy;
}
