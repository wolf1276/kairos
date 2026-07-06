// Memory Orchestrator — the single assembly point for MemoryPackage, the Memory Engine's one
// immutable snapshot of "what this agent remembers right now". Gathers Episodic, Semantic, and
// Working memory from their providers, validates the result, and freezes it. Never reasons,
// ranks, summarizes, or learns — see docs/architecture/MEMORY_ENGINE.md.
import { randomUUID, createHash } from 'crypto';
import { getEpisodicMemoryProvider, getSemanticMemoryProvider, getWorkingMemoryProvider } from './providers/index.js';
import { validateMemoryPackage } from './validation.js';
import { MEMORY_PACKAGE_SCHEMA_VERSION } from './types.js';
import type { MemoryPackage } from './types.js';
import { recordMemoryAssembly, recordMemoryValidation } from './metrics.js';
import { stableStringify } from '../stableStringify.js';

export class MemoryOrchestratorError extends Error {}

/** Counter of in-flight assembleMemoryPackage calls. Providers check this before swapping to
 *  prevent an inconsistent assembly that would read from old and new provider state. */
let assemblyInProgress = 0;

/** Returns true when one or more assembleMemoryPackage calls are currently in-flight. A provider
 *  swap during assembly could produce an inconsistent MemoryPackage — callers must wait. */
export function isAssemblyInProgress(): boolean {
  return assemblyInProgress > 0;
}

function computeMemoryPackageHash(input: Pick<MemoryPackage, 'episodic' | 'semantic' | 'working' | 'validation' | 'status'> & { agentId: string; version: string }): string {
  return createHash('sha256').update(stableStringify(input)).digest('hex');
}

/** Recursively freezes an object and all nested arrays/objects so the returned MemoryPackage
 *  is truly immutable — consumers cannot push to arrays, mutate records, or inject errors. */
function deepFreeze<T>(obj: T): T {
  if (obj !== null && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const value of Object.values(obj as Record<string, unknown>)) deepFreeze(value);
  }
  return obj;
}

/**
 * Assembles the immutable MemoryPackage for one agent. Reads episodic/semantic/working memory
 * through their provider abstractions only — never a concrete storage mechanism — validates
 * the assembled records, and freezes the result. Always returns a fully-formed MemoryPackage,
 * even when validation fails, so callers can see *why*; `status`/`validation.ok` must be
 * checked before handing the package to any future Reasoning Layer.
 */
export async function assembleMemoryPackage(agentId: string): Promise<MemoryPackage> {
  const start = performance.now();
  try {
    const pkg = await assembleMemoryPackageInner(agentId);
    recordMemoryAssembly(performance.now() - start, 'success');
    return pkg;
  } catch (error) {
    recordMemoryAssembly(performance.now() - start, 'failure');
    throw error;
  }
}

async function assembleMemoryPackageInner(agentId: string): Promise<MemoryPackage> {
  if (!agentId) throw new MemoryOrchestratorError('assembleMemoryPackage requires a non-empty agentId');

  try {
    assemblyInProgress++;
    const [rawEpisodic, rawSemantic, working] = await Promise.all([
      getEpisodicMemoryProvider().list(agentId),
      getSemanticMemoryProvider().list(agentId),
      getWorkingMemoryProvider().list(agentId),
    ]);

    // Filter records whose agentId matches the requested agent — defensive guard against
    // mis-keyed records that could leak across agents.
    const episodic = rawEpisodic.filter((r) => r.agentId === agentId);
    const semantic = rawSemantic.filter((f) => f.agentId === agentId);

    const validation = validateMemoryPackage({ episodic, semantic, working, schemaVersion: MEMORY_PACKAGE_SCHEMA_VERSION });
    // Derive status from validation.errors directly (not validation.ok) so there is exactly one
    // source of truth for "is this package invalid" — mirrors contextBuilder.ts's status derivation.
    const status = validation.errors.length === 0 ? ('valid' as const) : ('invalid' as const);
    recordMemoryValidation(validation.ok, validation.errors);

    const packageHash = computeMemoryPackageHash({
      agentId,
      version: MEMORY_PACKAGE_SCHEMA_VERSION,
      episodic,
      semantic,
      working,
      validation,
      status,
    });

    const memoryPackage: MemoryPackage = {
      meta: {
        version: MEMORY_PACKAGE_SCHEMA_VERSION,
        agentId,
        timestamp: Date.now(),
        packageId: randomUUID(),
        packageHash,
      },
      episodic,
      semantic,
      working,
      validation,
      status,
    };

    return deepFreeze(memoryPackage);
  } finally {
    assemblyInProgress--;
  }
}
