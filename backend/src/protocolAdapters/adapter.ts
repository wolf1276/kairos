// The ProtocolAdapter contract. Every protocol integration (Blend, Soroswap, Phoenix — none
// implemented here) must satisfy this interface. Nothing outside `protocolAdapters/` may call a
// protocol SDK directly; everything goes through an adapter registered in ProtocolRegistry.
import type {
  ProtocolCapabilities,
  AdapterActionRequest,
  ValidationResult,
  SimulationResult,
  AdapterExecutionResult,
  HealthStatus,
  Quote,
  TransactionBuilder,
} from './types.js';

export interface ProtocolAdapter {
  readonly protocol: string;
  readonly version: string;

  /** One-time setup (connection warmup, config load, etc.) — must be called, and must resolve,
   *  before the registry considers the adapter usable. Idempotent: calling it again is safe. */
  initialize(): Promise<void>;

  /** Live health check — never cached by the registry, always re-queried, so a registry consumer
   *  can never be fooled by a stale READY. */
  health(): Promise<HealthStatus>;

  /** The adapter's own declared capability set. Must be a pure, synchronous function of the
   *  adapter's fixed configuration — capabilities are not expected to change post-construction;
   *  an adapter that needs different capabilities is a different registration. */
  capabilities(): ProtocolCapabilities;

  simulate(request: AdapterActionRequest): Promise<SimulationResult>;
  validate(request: AdapterActionRequest): Promise<ValidationResult>;
  execute(request: AdapterActionRequest): Promise<AdapterExecutionResult>;
  estimateFees(request: AdapterActionRequest): Promise<string>;
  estimateSlippage(request: AdapterActionRequest): Promise<number>;

  /** Optional: a standardized price quote. Not every protocol has a meaningful quote (e.g. a
   *  pure lending pool), so this is not part of every adapter's required surface. */
  quote?(request: AdapterActionRequest): Promise<Quote>;

  /** Optional: pre-build an unsigned transaction description for a validated request. Never
   *  submits anything — building and submitting are deliberately separate steps. */
  buildTransaction?(request: AdapterActionRequest): Promise<TransactionBuilder>;
}
