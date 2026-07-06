// Memory-shape scenarios: empty memory vs. a rich episodic/semantic history.
import { deepMerge } from '../utils/deepMerge.js';
import { baseAgentContext, baseMemoryPackage, baseUserPolicy, BASE_AGENT_ID } from './baseFixtures.js';
import type { BenchmarkScenario } from './types.js';

const V = '1.0.0';

export const memoryScenarios: BenchmarkScenario[] = [
  {
    id: 'empty_memory',
    name: 'Empty memory',
    category: 'empty_memory',
    version: V,
    description: 'No episodic, semantic, or working memory — the agent has no experiential history to draw on.',
    agentContext: baseAgentContext(),
    memoryPackage: deepMerge(baseMemoryPackage(), { episodic: [], semantic: [], working: [] }),
    userPolicy: baseUserPolicy(),
  },
  {
    id: 'rich_memory',
    name: 'Rich memory',
    category: 'rich_memory',
    version: V,
    description: 'Multiple episodic outcomes (win/loss) plus semantic facts — tests whether reasoning cites historical_statistic/historical_pattern evidence.',
    agentContext: baseAgentContext(),
    memoryPackage: deepMerge(baseMemoryPackage(), {
      episodic: [
        {
          id: 'ep-1', agentId: BASE_AGENT_ID, timestamp: Date.now() - 86400000, contextRef: 'snap-1',
          decisionRef: 'dec-1', executionRef: 'exec-1', outcome: 'win', pnl: 22.5, holdingTimeSeconds: 3600,
          confidence: 0.8, quality: 'high', tags: ['xlm', 'trend'],
        },
        {
          id: 'ep-2', agentId: BASE_AGENT_ID, timestamp: Date.now() - 172800000, contextRef: 'snap-2',
          decisionRef: 'dec-2', executionRef: 'exec-2', outcome: 'loss', pnl: -8.1, holdingTimeSeconds: 1800,
          confidence: 0.6, quality: 'medium', tags: ['xlm'],
        },
        {
          id: 'ep-3', agentId: BASE_AGENT_ID, timestamp: Date.now() - 259200000, contextRef: 'snap-3',
          decisionRef: 'dec-3', executionRef: 'exec-3', outcome: 'win', pnl: 15.0, holdingTimeSeconds: 5400,
          confidence: 0.75, quality: 'high', tags: ['xlm', 'trend'],
        },
      ],
      semantic: [
        { id: 'fact-1', agentId: BASE_AGENT_ID, key: 'preferred-pair', value: 'XLM/USDC', confidence: 1, updatedAt: Date.now(), tags: [] },
        { id: 'fact-2', agentId: BASE_AGENT_ID, key: 'recent-regime', value: 'trending_up', confidence: 0.8, updatedAt: Date.now(), tags: [] },
      ],
      working: [],
    }),
    userPolicy: baseUserPolicy(),
  },
];
