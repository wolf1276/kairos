// Protocol adapter contract. The Execution Engine communicates with the outside world ONLY
// through this interface — it never imports a protocol SDK directly. No concrete adapter
// (Blend, a DEX, etc.) is implemented here; that is explicitly out of scope for Phase 6. Callers
// supply their own ProtocolAdapter implementations via the registry passed into `executePlan`.
import type { PlanStep } from '../executionPlanner/types.js';
import type { StepSimulationResult } from './types.js';

export interface AdapterSubmitResult {
  transactionId: string;
  fee: string;
}

export interface AdapterConfirmResult {
  status: 'confirmed' | 'failed' | 'timeout';
  errorMessage?: string;
}

/** One protocol's execution surface. Every method is async so both real network adapters and
 *  synchronous test doubles satisfy the same interface. */
export interface ProtocolAdapter {
  protocol: string;
  simulate(step: PlanStep): Promise<StepSimulationResult>;
  submit(step: PlanStep): Promise<AdapterSubmitResult>;
  confirm(step: PlanStep, transactionId: string): Promise<AdapterConfirmResult>;
}

export type ProtocolAdapterRegistry = Record<string, ProtocolAdapter>;

export class AdapterNotFoundError extends Error {
  constructor(protocol: string) {
    super(`No protocol adapter registered for '${protocol}' — Execution Engine cannot call a protocol SDK directly.`);
    this.name = 'AdapterNotFoundError';
  }
}

export function resolveAdapter(registry: ProtocolAdapterRegistry, protocol: string): ProtocolAdapter {
  const adapter = registry[protocol];
  if (!adapter) throw new AdapterNotFoundError(protocol);
  return adapter;
}
