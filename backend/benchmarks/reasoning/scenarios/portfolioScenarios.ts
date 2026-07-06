// Portfolio-size scenarios: small vs. large managed capital.
import { deepMerge } from '../utils/deepMerge.js';
import { baseAgentContext, baseMemoryPackage, baseUserPolicy } from './baseFixtures.js';
import type { BenchmarkScenario } from './types.js';

const V = '1.0.0';

export const portfolioScenarios: BenchmarkScenario[] = [
  {
    id: 'small_portfolio',
    name: 'Small portfolio',
    category: 'small_portfolio',
    version: V,
    description: 'Total managed capital of 50 units — tests behavior near minimum viable position sizes.',
    agentContext: deepMerge(baseAgentContext(), {
      capital: { totalManagedCapital: 50, idleCapital: 5, deployableCapital: 45 },
      features: { portfolio: { totalValue: 50 } },
    }),
    memoryPackage: baseMemoryPackage(),
    userPolicy: baseUserPolicy(),
  },
  {
    id: 'large_portfolio',
    name: 'Large portfolio',
    category: 'large_portfolio',
    version: V,
    description: 'Total managed capital of 1,000,000 units — tests behavior at institutional scale.',
    agentContext: deepMerge(baseAgentContext(), {
      capital: { totalManagedCapital: 1000000, idleCapital: 150000, deployableCapital: 850000 },
      features: { portfolio: { totalValue: 1000000 } },
    }),
    memoryPackage: baseMemoryPackage(),
    userPolicy: baseUserPolicy(),
  },
];
