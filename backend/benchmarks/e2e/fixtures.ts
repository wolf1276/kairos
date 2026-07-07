// Frozen, reusable E2E fixture inputs. Reuses the existing reasoning-benchmark base fixtures
// (Context/Memory/Policy) rather than duplicating them — see benchmarks/reasoning/scenarios/baseFixtures.ts.
import { baseAgentContext, baseMemoryPackage, baseUserPolicy } from '../reasoning/scenarios/baseFixtures.js';
import { sha256 } from '../../src/reasoning/hashing.js';
import type { AgentContext } from '../../src/agentContext/index.js';
import type { MemoryPackage } from '../../src/memoryLayer/index.js';
import type { UserPolicy } from '../../src/reasoning/types.js';

export interface PipelineFixtures {
  agentContext: AgentContext;
  memoryPackage: MemoryPackage;
  userPolicy: UserPolicy;
}

/** Builds one fixed set of pipeline inputs. Called once per harness (not once per iteration) so
 *  "identical inputs" is a literal, single frozen object graph shared across every run. */
/** Protocol the pipeline routes to end-to-end (soroswap: a SWAP whose adapter fully supports
 *  buildTransaction/simulate/validate/estimateFees against deterministic test doubles — see
 *  registry.ts). Both AgentContext.policy and UserPolicy must allow it, or Decision
 *  Intelligence's own validation (deriveAllowedPolicy) fails closed before a plan is ever built. */
export const FIXTURE_PROTOCOL = 'soroswap';
export const FIXTURE_ASSET = 'XLM';
export const FIXTURE_OUTPUT_ASSET = 'USDC';

export function buildFixtures(): PipelineFixtures {
  const agentContext = baseAgentContext();
  const memoryPackage = baseMemoryPackage();
  const userPolicy = baseUserPolicy();

  const patchedAgentContext: AgentContext = {
    ...agentContext,
    policy: { ...agentContext.policy, allowedProtocols: [...agentContext.policy.allowedProtocols, FIXTURE_PROTOCOL] },
    meta: { ...agentContext.meta, contextHash: sha256('fixture-agent-context') },
  };
  const patchedUserPolicy: UserPolicy = {
    ...userPolicy,
    allowedProtocols: [...userPolicy.allowedProtocols, FIXTURE_PROTOCOL],
  };

  const patchedMemoryPackage: MemoryPackage = {
    ...memoryPackage,
    meta: { ...memoryPackage.meta, packageHash: sha256('fixture-memory-package') },
  };

  return { agentContext: patchedAgentContext, memoryPackage: patchedMemoryPackage, userPolicy: patchedUserPolicy };
}
