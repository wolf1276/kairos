// Provider registry — the single place that knows the concrete memory storage implementations.
// Everything else in memoryLayer imports the provider interfaces and calls get*Provider();
// swapping in a SQLite/Postgres-backed provider later is a one-line set*Provider() call, with
// no change to orchestrator.ts. Mirrors agentContext/cache/index.ts's registry pattern.
import { InMemoryEpisodicProvider } from './inMemoryEpisodicProvider.js';
import { InMemorySemanticProvider } from './inMemorySemanticProvider.js';
import { InMemoryWorkingProvider } from './inMemoryWorkingProvider.js';
import type { EpisodicMemoryProvider, SemanticMemoryProvider, WorkingMemoryProvider } from './types.js';
import { isAssemblyInProgress } from '../orchestrator.js';

let episodicProvider: EpisodicMemoryProvider = new InMemoryEpisodicProvider();
let semanticProvider: SemanticMemoryProvider = new InMemorySemanticProvider();
let workingProvider: WorkingMemoryProvider = new InMemoryWorkingProvider();

const EPISODIC_REQUIRED_METHODS = ['append', 'list', 'get', 'size'] as const;
const SEMANTIC_REQUIRED_METHODS = ['upsert', 'list', 'get', 'clear', 'size'] as const;
const WORKING_REQUIRED_METHODS = ['get', 'set', 'invalidate', 'clear', 'list', 'size'] as const;

/** A provider missing a required method would fail deep inside an orchestrator assembly, not
 *  at the call site that made the mistake — validate the shape up front so a bad swap fails
 *  loudly and immediately. */
function assertHasMethods(candidate: object, methods: readonly string[], label: string): void {
  for (const method of methods) {
    if (typeof (candidate as Record<string, unknown>)?.[method] !== 'function') {
      throw new Error(`Invalid ${label}: missing required method '${method}'`);
    }
  }
}

export function getEpisodicMemoryProvider(): EpisodicMemoryProvider {
  return episodicProvider;
}

export function setEpisodicMemoryProvider(next: EpisodicMemoryProvider): void {
  if (isAssemblyInProgress()) throw new Error('Cannot swap EpisodicMemoryProvider during active assembly');
  assertHasMethods(next, EPISODIC_REQUIRED_METHODS, 'EpisodicMemoryProvider');
  episodicProvider.dispose?.();
  episodicProvider = next;
}

export function resetEpisodicMemoryProvider(): void {
  episodicProvider.dispose?.();
  episodicProvider = new InMemoryEpisodicProvider();
}

export function getSemanticMemoryProvider(): SemanticMemoryProvider {
  return semanticProvider;
}

export function setSemanticMemoryProvider(next: SemanticMemoryProvider): void {
  if (isAssemblyInProgress()) throw new Error('Cannot swap SemanticMemoryProvider during active assembly');
  assertHasMethods(next, SEMANTIC_REQUIRED_METHODS, 'SemanticMemoryProvider');
  semanticProvider.dispose?.();
  semanticProvider = next;
}

export function resetSemanticMemoryProvider(): void {
  semanticProvider.dispose?.();
  semanticProvider = new InMemorySemanticProvider();
}

export function getWorkingMemoryProvider(): WorkingMemoryProvider {
  return workingProvider;
}

export function setWorkingMemoryProvider(next: WorkingMemoryProvider): void {
  if (isAssemblyInProgress()) throw new Error('Cannot swap WorkingMemoryProvider during active assembly');
  assertHasMethods(next, WORKING_REQUIRED_METHODS, 'WorkingMemoryProvider');
  workingProvider.dispose?.();
  workingProvider = next;
}

export function resetWorkingMemoryProvider(): void {
  workingProvider.dispose?.();
  workingProvider = new InMemoryWorkingProvider();
}

/** Resets all three providers at once — mainly for test isolation. */
export function resetAllMemoryProviders(): void {
  resetEpisodicMemoryProvider();
  resetSemanticMemoryProvider();
  resetWorkingMemoryProvider();
}

export { InMemoryEpisodicProvider, InMemorySemanticProvider, InMemoryWorkingProvider };
export type { EpisodicMemoryProvider, SemanticMemoryProvider, WorkingMemoryProvider } from './types.js';
