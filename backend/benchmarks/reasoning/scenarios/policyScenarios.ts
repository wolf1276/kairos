// Policy-profile scenarios: conservative, balanced, aggressive — realistic production policy
// ceilings, replacing the unrealistic flat 25% used in earlier ad-hoc benchmarks.
import { deepMerge } from '../utils/deepMerge.js';
import { baseAgentContext, baseMemoryPackage, baseUserPolicy } from './baseFixtures.js';
import type { BenchmarkScenario } from './types.js';

const V = '1.0.0';

export const policyScenarios: BenchmarkScenario[] = [
  {
    id: 'conservative_policy',
    name: 'Conservative policy',
    category: 'conservative_policy',
    version: V,
    description: 'Low risk tolerance, tight 15% allocation ceiling, high 0.75 minimum confidence — capital preservation focus.',
    agentContext: baseAgentContext(),
    memoryPackage: baseMemoryPackage(),
    userPolicy: deepMerge(baseUserPolicy(), {
      userId: 'user-conservative', riskTolerance: 'low', maxAllocationPct: 15, minConfidence: 0.75,
      objectives: ['preserve capital', 'minimize drawdown'],
    }),
  },
  {
    id: 'balanced_policy',
    name: 'Balanced policy',
    category: 'balanced_policy',
    version: V,
    description: 'Medium risk tolerance, 35% allocation ceiling, 0.6 minimum confidence — the default production profile.',
    agentContext: baseAgentContext(),
    memoryPackage: baseMemoryPackage(),
    userPolicy: deepMerge(baseUserPolicy(), {
      userId: 'user-balanced', riskTolerance: 'medium', maxAllocationPct: 35, minConfidence: 0.6,
      objectives: ['grow capital steadily', 'manage risk'],
    }),
  },
  {
    id: 'aggressive_policy',
    name: 'Aggressive policy',
    category: 'aggressive_policy',
    version: V,
    description: 'High risk tolerance, 65% allocation ceiling, 0.45 minimum confidence — growth-maximizing profile.',
    agentContext: baseAgentContext(),
    memoryPackage: baseMemoryPackage(),
    userPolicy: deepMerge(baseUserPolicy(), {
      userId: 'user-aggressive', riskTolerance: 'high', maxAllocationPct: 65, minConfidence: 0.45,
      objectives: ['maximize growth', 'capture trend upside'],
    }),
  },
];
