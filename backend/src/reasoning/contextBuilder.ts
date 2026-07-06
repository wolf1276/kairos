// Reasoning Context Builder — combines AgentContext + MemoryPackage + UserPolicy into one
// immutable, recursively-frozen ReasoningContext. No database access, no providers, no HTTP,
// no blockchain — reasoning consumes only the three inputs it is handed.
import { randomUUID } from 'crypto';
import { hashReasoningContext } from './hashing.js';
import { REASONING_ENGINE_SCHEMA_VERSION } from './types.js';
import type { AgentContext } from '../agentContext/index.js';
import type { MemoryPackage } from '../memoryLayer/index.js';
import type { ReasoningContext, UserPolicy } from './types.js';

export class ReasoningContextError extends Error {}

/** Recursively freezes an object graph so no downstream consumer (prompt builder, provider,
 *  validation) can mutate a ReasoningContext once built. Arrays and plain objects are frozen;
 *  primitives pass through untouched. */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

function computeReasoningContextHash(agentContext: AgentContext, memoryPackage: MemoryPackage, userPolicy: UserPolicy): string {
  return hashReasoningContext({
    agentId: agentContext.agentId,
    agentContextHash: agentContext.meta.contextHash,
    memoryPackageHash: memoryPackage.meta.packageHash,
    userPolicy,
  });
}

/**
 * Builds the immutable ReasoningContext for one agent. Purely a combination step — trusts that
 * AgentContext and MemoryPackage were already validated by their own engines; performs no I/O
 * and calls no provider. Always returns a frozen ReasoningContext; callers should check
 * agentContext.status / memoryPackage.status before treating it as trustworthy.
 */
export function buildReasoningContext(
  agentContext: AgentContext,
  memoryPackage: MemoryPackage,
  userPolicy: UserPolicy
): ReasoningContext {
  if (!agentContext) throw new ReasoningContextError('agentContext is required');
  if (!memoryPackage) throw new ReasoningContextError('memoryPackage is required');
  if (!userPolicy) throw new ReasoningContextError('userPolicy is required');
  if (agentContext.agentId !== memoryPackage.meta.agentId) {
    throw new ReasoningContextError(
      `agentContext.agentId (${agentContext.agentId}) does not match memoryPackage.meta.agentId (${memoryPackage.meta.agentId})`
    );
  }

  const reasoningContextHash = computeReasoningContextHash(agentContext, memoryPackage, userPolicy);

  const context: ReasoningContext = {
    meta: {
      version: REASONING_ENGINE_SCHEMA_VERSION,
      timestamp: Date.now(),
      agentId: agentContext.agentId,
      reasoningContextHash,
      contextId: randomUUID(),
    },
    agentContext,
    memoryPackage,
    userPolicy,
  };

  return deepFreeze(context);
}
