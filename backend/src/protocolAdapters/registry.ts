// ProtocolRegistry: the single point through which an Execution Engine may reach a protocol
// adapter. Fail-closed throughout — an unregistered/duplicate/malformed adapter is always
// rejected, never silently accepted or overwritten.
import { hashCapabilities, hashAdapter } from './hashing.js';
import type { ProtocolAdapter } from './adapter.js';
import type { ProtocolCapabilities, ProtocolMetadata, HealthStatus } from './types.js';

export class DuplicateAdapterError extends Error {
  constructor(protocol: string) {
    super(`An adapter is already registered for protocol '${protocol}' — unregister it first.`);
    this.name = 'DuplicateAdapterError';
  }
}

export class AdapterNotFoundError extends Error {
  constructor(protocol: string) {
    super(`No adapter is registered for protocol '${protocol}'.`);
    this.name = 'AdapterNotFoundError';
  }
}

export class MalformedAdapterError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`Adapter registration rejected: ${errors.join('; ')}`);
    this.name = 'MalformedAdapterError';
    this.errors = errors;
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/** Validates an adapter's shape and capability declaration before it's ever allowed into the
 *  registry — malformed metadata (missing/empty required fields, or a capability declaration
 *  whose own `protocol` field doesn't match the adapter's `protocol`, i.e. adapter spoofing) is
 *  rejected here, not discovered later at lookup time. */
function validateAdapterShape(adapter: ProtocolAdapter): string[] {
  const errors: string[] = [];
  if (!adapter || typeof adapter !== 'object') return ['adapter must be a non-null object'];
  if (typeof adapter.protocol !== 'string' || adapter.protocol.length === 0) errors.push('adapter.protocol must be a non-empty string');
  if (typeof adapter.version !== 'string' || adapter.version.length === 0) errors.push('adapter.version must be a non-empty string');
  for (const method of ['initialize', 'health', 'capabilities', 'simulate', 'validate', 'execute', 'estimateFees', 'estimateSlippage'] as const) {
    if (typeof adapter[method] !== 'function') errors.push(`adapter.${method} must be a function`);
  }
  if (errors.length > 0) return errors;

  let capabilities: ProtocolCapabilities;
  try {
    capabilities = adapter.capabilities();
  } catch {
    return ['adapter.capabilities() threw — must be a pure synchronous function'];
  }
  if (!capabilities || typeof capabilities !== 'object') return ['adapter.capabilities() must return a non-null object'];
  if (capabilities.protocol !== adapter.protocol) errors.push(`capabilities.protocol ('${capabilities.protocol}') must match adapter.protocol ('${adapter.protocol}') — capability spoofing is rejected`);
  if (!Array.isArray(capabilities.supportedActions) || capabilities.supportedActions.length === 0) errors.push('capabilities.supportedActions must be a non-empty array');
  if (!Array.isArray(capabilities.supportedAssets) || capabilities.supportedAssets.length === 0) errors.push('capabilities.supportedAssets must be a non-empty array');
  if (!Array.isArray(capabilities.supportedNetworks) || capabilities.supportedNetworks.length === 0) errors.push('capabilities.supportedNetworks must be a non-empty array');
  for (const flag of ['simulationSupport', 'batchingSupport', 'rollbackSupport'] as const) {
    if (typeof capabilities[flag] !== 'boolean') errors.push(`capabilities.${flag} must be a boolean`);
  }
  return errors;
}

interface RegistryEntry {
  adapter: ProtocolAdapter;
  metadata: ProtocolMetadata;
}

/**
 * Holds registered ProtocolAdapters keyed by protocol name. Every registry method is
 * synchronous except `health()` (which live-queries the adapter) and never exposes the live
 * internal map — `list()`/`lookupMetadata()` return frozen snapshots, so a caller mutating the
 * returned value can never corrupt the registry's own state.
 */
export class ProtocolRegistry {
  private readonly entries = new Map<string, RegistryEntry>();

  register(adapter: ProtocolAdapter, options: { now?: () => number } = {}): ProtocolMetadata {
    const shapeErrors = validateAdapterShape(adapter);
    if (shapeErrors.length > 0) throw new MalformedAdapterError(shapeErrors);

    if (this.entries.has(adapter.protocol)) throw new DuplicateAdapterError(adapter.protocol);

    const capabilities = deepFreeze({ ...adapter.capabilities() });
    const capabilityHash = hashCapabilities(capabilities);
    const adapterHash = hashAdapter(adapter.protocol, adapter.version, capabilityHash);
    const now = options.now ?? Date.now;

    const metadata: ProtocolMetadata = deepFreeze({
      protocol: adapter.protocol,
      version: adapter.version,
      capabilities,
      registeredAt: now(),
      adapterHash,
      capabilityHash,
    });

    this.entries.set(adapter.protocol, { adapter, metadata });
    return metadata;
  }

  unregister(protocol: string): void {
    if (!this.entries.has(protocol)) throw new AdapterNotFoundError(protocol);
    this.entries.delete(protocol);
  }

  lookup(protocol: string): ProtocolAdapter {
    const entry = this.entries.get(protocol);
    if (!entry) throw new AdapterNotFoundError(protocol);
    return entry.adapter;
  }

  lookupMetadata(protocol: string): ProtocolMetadata {
    const entry = this.entries.get(protocol);
    if (!entry) throw new AdapterNotFoundError(protocol);
    return entry.metadata;
  }

  async health(protocol: string): Promise<HealthStatus> {
    const entry = this.entries.get(protocol);
    if (!entry) throw new AdapterNotFoundError(protocol);
    return entry.adapter.health();
  }

  list(): ProtocolMetadata[] {
    return Object.freeze([...this.entries.values()].map((e) => e.metadata).sort((a, b) => a.protocol.localeCompare(b.protocol))) as ProtocolMetadata[];
  }

  has(protocol: string): boolean {
    return this.entries.has(protocol);
  }
}
