// Public surface of the Protocol Adapter Framework. Callers (a future Execution Engine) import
// only from here.
export { ProtocolRegistry, DuplicateAdapterError, AdapterNotFoundError, MalformedAdapterError } from './registry.js';
export { createAdapter, AdapterSpecMismatchError } from './factory.js';
export { hashCapabilities, hashAdapter, hashSimulationResult } from './hashing.js';
export { PROTOCOL_ADAPTER_FRAMEWORK_VERSION, HEALTH_STATUSES, EXECUTION_STATUSES } from './types.js';

export type { ProtocolAdapter } from './adapter.js';
export type { AdapterSpec } from './factory.js';
export type {
  HealthStatus,
  ProtocolCapabilities,
  AdapterActionRequest,
  ValidationResult,
  SimulationResult,
  AdapterExecutionStatus,
  AdapterExecutionResult,
  ProtocolMetadata,
} from './types.js';
