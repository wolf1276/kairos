// Protocol Adapter Framework — exhaustive test suite. No blockchain logic under test: every
// adapter here is a deterministic in-memory double built via createAdapter().
import { describe, it, expect } from 'vitest';
import {
  ProtocolRegistry,
  DuplicateAdapterError,
  AdapterNotFoundError,
  MalformedAdapterError,
  createAdapter,
  AdapterSpecMismatchError,
  hashCapabilities,
  hashAdapter,
} from '../protocolAdapters/index.js';
import type { ProtocolAdapter, ProtocolCapabilities, HealthStatus } from '../protocolAdapters/index.js';

function makeCapabilities(overrides: Partial<ProtocolCapabilities> = {}): ProtocolCapabilities {
  return {
    protocol: 'blend',
    supportedActions: ['DEPOSIT', 'WITHDRAW', 'SWAP'],
    supportedAssets: ['XLM', 'USDC'],
    supportedNetworks: ['testnet', 'mainnet'],
    simulationSupport: true,
    batchingSupport: false,
    rollbackSupport: true,
    ...overrides,
  };
}

function makeAdapter(overrides: Partial<Parameters<typeof createAdapter>[0]> = {}): ProtocolAdapter {
  return createAdapter({
    protocol: 'blend',
    version: '1.0.0',
    capabilities: makeCapabilities(),
    ...overrides,
  });
}

const req = { action: 'DEPOSIT', asset: 'XLM', network: 'testnet', amount: '10.000000' };

// ── Registration ─────────────────────────────────────────────────────────────────────────────

describe('registration', () => {
  it('registers an adapter and returns frozen metadata', () => {
    const registry = new ProtocolRegistry();
    const metadata = registry.register(makeAdapter());
    expect(metadata.protocol).toBe('blend');
    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.isFrozen(metadata.capabilities)).toBe(true);
  });

  it('rejects duplicate registration for the same protocol', () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAdapter());
    expect(() => registry.register(makeAdapter())).toThrow(DuplicateAdapterError);
  });

  it('allows re-registration after unregister', () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAdapter());
    registry.unregister('blend');
    expect(() => registry.register(makeAdapter())).not.toThrow();
  });

  it('rejects malformed metadata: missing required capability arrays', () => {
    const registry = new ProtocolRegistry();
    const adapter = makeAdapter({ capabilities: makeCapabilities({ supportedActions: [] }) });
    expect(() => registry.register(adapter)).toThrow(MalformedAdapterError);
  });

  it('rejects malformed metadata: non-boolean capability flag', () => {
    const registry = new ProtocolRegistry();
    const adapter = makeAdapter({ capabilities: { ...makeCapabilities(), simulationSupport: 'yes' as unknown as boolean } });
    expect(() => registry.register(adapter)).toThrow(MalformedAdapterError);
  });

  it('rejects an adapter missing a required method', () => {
    const registry = new ProtocolRegistry();
    const adapter = { ...makeAdapter() } as Partial<ProtocolAdapter>;
    delete (adapter as { execute?: unknown }).execute;
    expect(() => registry.register(adapter as ProtocolAdapter)).toThrow(MalformedAdapterError);
  });
});

// ── Lookup / unregister ──────────────────────────────────────────────────────────────────────

describe('lookup and unregister', () => {
  it('lookup returns the registered adapter', () => {
    const registry = new ProtocolRegistry();
    const adapter = makeAdapter();
    registry.register(adapter);
    expect(registry.lookup('blend')).toBe(adapter);
  });

  it('lookup of an unregistered protocol throws AdapterNotFoundError', () => {
    const registry = new ProtocolRegistry();
    expect(() => registry.lookup('nonexistent')).toThrow(AdapterNotFoundError);
  });

  it('unregister removes the adapter; subsequent lookup fails closed', () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAdapter());
    registry.unregister('blend');
    expect(() => registry.lookup('blend')).toThrow(AdapterNotFoundError);
  });

  it('unregistering a nonexistent protocol throws rather than silently no-op-ing', () => {
    const registry = new ProtocolRegistry();
    expect(() => registry.unregister('ghost')).toThrow(AdapterNotFoundError);
  });

  it('list() returns all registered protocols, sorted, and frozen', () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAdapter({ protocol: 'soroswap', capabilities: makeCapabilities({ protocol: 'soroswap' }) }));
    registry.register(makeAdapter({ protocol: 'blend', capabilities: makeCapabilities({ protocol: 'blend' }) }));
    const list = registry.list();
    expect(list.map((m) => m.protocol)).toEqual(['blend', 'soroswap']);
    expect(Object.isFrozen(list)).toBe(true);
  });
});

// ── Capability validation ────────────────────────────────────────────────────────────────────

describe('capability validation', () => {
  it('validate() accepts a request matching declared capabilities', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate(req);
    expect(result.ok).toBe(true);
  });

  it('rejects unsupported action', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...req, action: 'TELEPORT' });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/action/);
  });

  it('rejects unsupported asset', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...req, asset: 'SHIB' });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/asset/);
  });

  it('rejects unsupported network', async () => {
    const adapter = makeAdapter();
    const result = await adapter.validate({ ...req, network: 'devnet' });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/network/);
  });

  it('rejects a request missing a required parameter', async () => {
    const adapter = makeAdapter({ requiredParams: { DEPOSIT: ['minOutput'] } });
    const result = await adapter.validate(req);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/minOutput/);
  });

  it('accepts a request with the required parameter present', async () => {
    const adapter = makeAdapter({ requiredParams: { DEPOSIT: ['minOutput'] } });
    const result = await adapter.validate({ ...req, params: { minOutput: '9.9' } });
    expect(result.ok).toBe(true);
  });
});

// ── Health transitions ───────────────────────────────────────────────────────────────────────

describe('health transitions', () => {
  it('reports READY by default', async () => {
    const adapter = makeAdapter();
    expect(await adapter.health()).toBe('READY');
  });

  it('registry.health() always live-queries the adapter, reflecting a health change after registration', async () => {
    let current: HealthStatus = 'READY';
    const registry = new ProtocolRegistry();
    registry.register(makeAdapter({ onHealth: () => current }));
    expect(await registry.health('blend')).toBe('READY');
    current = 'DEGRADED';
    expect(await registry.health('blend')).toBe('DEGRADED');
    current = 'UNAVAILABLE';
    expect(await registry.health('blend')).toBe('UNAVAILABLE');
  });

  it('health() of an unregistered protocol throws', async () => {
    const registry = new ProtocolRegistry();
    await expect(registry.health('ghost')).rejects.toThrow(AdapterNotFoundError);
  });

  it('UNKNOWN is a valid reportable health status', async () => {
    const adapter = makeAdapter({ onHealth: () => 'UNKNOWN' });
    expect(await adapter.health()).toBe('UNKNOWN');
  });
});

// ── Simulation ────────────────────────────────────────────────────────────────────────────────

describe('simulation', () => {
  it('simulate() succeeds for a valid request and includes fees/slippage/outputs', async () => {
    const adapter = makeAdapter({ onEstimateFees: () => '0.500000', onEstimateSlippage: () => 1.2 });
    const result = await adapter.simulate(req);
    expect(result.success).toBe(true);
    expect(result.estimatedFees).toBe('0.500000');
    expect(result.estimatedSlippagePct).toBe(1.2);
    expect(result.errors).toEqual([]);
    expect(typeof result.simulationHash).toBe('string');
  });

  it('simulate() fails closed for an invalid request, surfacing validation errors', async () => {
    const adapter = makeAdapter();
    const result = await adapter.simulate({ ...req, action: 'TELEPORT' });
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('simulate() can report warnings without failing', async () => {
    const adapter = makeAdapter({ onSimulate: () => ({ warnings: ['high slippage expected'] }) });
    const result = await adapter.simulate(req);
    expect(result.success).toBe(true);
    expect(result.warnings).toContain('high slippage expected');
  });

  it('deterministic simulationHash for identical requests', async () => {
    const adapter = makeAdapter();
    const r1 = await adapter.simulate(req);
    const r2 = await adapter.simulate(req);
    expect(r1.simulationHash).toBe(r2.simulationHash);
  });
});

// ── Unsupported protocol / action / asset (registry-level) ─────────────────────────────────

describe('unsupported protocol / action / asset', () => {
  it('unsupported protocol: lookup fails closed', () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAdapter());
    expect(() => registry.lookup('phoenix')).toThrow(AdapterNotFoundError);
  });

  it('unsupported action against a registered adapter is rejected by validate(), not silently accepted', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAdapter());
    const adapter = registry.lookup('blend');
    const result = await adapter.validate({ ...req, action: 'REBALANCE_EVERYTHING' });
    expect(result.ok).toBe(false);
  });

  it('unsupported asset against a registered adapter is rejected by validate()', async () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAdapter());
    const adapter = registry.lookup('blend');
    const result = await adapter.validate({ ...req, asset: 'DOGE' });
    expect(result.ok).toBe(false);
  });
});

// ── Deterministic hashes / replay ────────────────────────────────────────────────────────────

describe('deterministic hashes and replay', () => {
  it('capabilityHash is order-independent for array fields', () => {
    const a = makeCapabilities({ supportedAssets: ['XLM', 'USDC'] });
    const b = makeCapabilities({ supportedAssets: ['USDC', 'XLM'] });
    expect(hashCapabilities(a)).toBe(hashCapabilities(b));
  });

  it('adapterHash is deterministic for the same protocol/version/capabilities', () => {
    const registry1 = new ProtocolRegistry();
    const registry2 = new ProtocolRegistry();
    const m1 = registry1.register(makeAdapter(), { now: () => 1000 });
    const m2 = registry2.register(makeAdapter(), { now: () => 2000 });
    expect(m1.adapterHash).toBe(m2.adapterHash); // registeredAt differs, adapterHash doesn't
    expect(m1.registeredAt).not.toBe(m2.registeredAt);
  });

  it('adapterHash changes if capabilities change', () => {
    const registry = new ProtocolRegistry();
    const m1 = registry.register(makeAdapter());
    registry.unregister('blend');
    const m2 = registry.register(makeAdapter({ capabilities: makeCapabilities({ batchingSupport: true }) }));
    expect(m1.adapterHash).not.toBe(m2.adapterHash);
  });

  it('replay: recomputing hashAdapter/hashCapabilities independently matches the registry-stored values', () => {
    const registry = new ProtocolRegistry();
    const metadata = registry.register(makeAdapter());
    expect(hashCapabilities(metadata.capabilities)).toBe(metadata.capabilityHash);
    expect(hashAdapter(metadata.protocol, metadata.version, metadata.capabilityHash)).toBe(metadata.adapterHash);
  });

  it('500 identical registrations (fresh registry each time) produce identical adapterHash/capabilityHash', () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const registry = new ProtocolRegistry();
      const metadata = registry.register(makeAdapter());
      hashes.add(`${metadata.adapterHash}:${metadata.capabilityHash}`);
    }
    expect(hashes.size).toBe(1);
  });
});

// ── Concurrency / stress ─────────────────────────────────────────────────────────────────────

describe('concurrency stress', () => {
  it.each([10, 50, 100, 250])('registers %i distinct protocols concurrently with no race conditions', async (n) => {
    const registry = new ProtocolRegistry();
    await Promise.all(
      Array.from({ length: n }, (_, i) => {
        const protocol = `protocol-${i}`;
        return Promise.resolve().then(() => registry.register(makeAdapter({ protocol, capabilities: makeCapabilities({ protocol } as Partial<ProtocolCapabilities>) })));
      })
    );
    expect(registry.list()).toHaveLength(n);
    for (let i = 0; i < n; i++) expect(registry.has(`protocol-${i}`)).toBe(true);
  });

  it('concurrent duplicate-registration attempts: exactly one succeeds, all others throw', async () => {
    const registry = new ProtocolRegistry();
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => Promise.resolve().then(() => registry.register(makeAdapter()))));
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);
    expect(registry.list()).toHaveLength(1);
  });

  it('registry state is deterministic regardless of registration order', () => {
    const registryA = new ProtocolRegistry();
    const registryB = new ProtocolRegistry();
    const protocols = ['blend', 'soroswap', 'phoenix'];
    for (const p of protocols) registryA.register(makeAdapter({ protocol: p, capabilities: makeCapabilities({ protocol: p }) }));
    for (const p of [...protocols].reverse()) registryB.register(makeAdapter({ protocol: p, capabilities: makeCapabilities({ protocol: p }) }));
    expect(registryA.list().map((m) => m.protocol)).toEqual(registryB.list().map((m) => m.protocol));
  });

  it('immutable metadata: mutating a returned ProtocolMetadata or capabilities object throws (strict mode) or is a no-op', () => {
    const registry = new ProtocolRegistry();
    const metadata = registry.register(makeAdapter());
    expect(() => {
      (metadata as { protocol: string }).protocol = 'hacked';
    }).toThrow();
    expect(registry.lookupMetadata('blend').protocol).toBe('blend');
  });
});

// ── Security ──────────────────────────────────────────────────────────────────────────────────

describe('security — every attack must fail', () => {
  it('adapter spoofing: capabilities.protocol must match adapter.protocol (hand-built adapter, bypassing the factory entirely)', () => {
    const registry = new ProtocolRegistry();
    const honest = makeAdapter();
    const spoofed: ProtocolAdapter = { ...honest, protocol: 'blend', capabilities: () => makeCapabilities({ protocol: 'soroswap' }) };
    expect(() => registry.register(spoofed)).toThrow(MalformedAdapterError);
  });

  // Regression: createAdapter() originally silently overwrote a mismatched
  // `capabilities.protocol` with `spec.protocol` instead of failing, which would have hidden a
  // real config bug in a future adapter spec (and made the registry-level spoofing defense above
  // untestable through the factory's own path).
  it('AdapterFactory itself fails loud on a protocol/capabilities.protocol mismatch, rather than silently reconciling', () => {
    expect(() => createAdapter({ protocol: 'blend', version: '1.0.0', capabilities: makeCapabilities({ protocol: 'soroswap' }) })).toThrow(AdapterSpecMismatchError);
  });

  it('duplicate IDs: two different adapter instances cannot both claim the same protocol', () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAdapter());
    const impostor = makeAdapter({ version: '9.9.9' });
    expect(() => registry.register(impostor)).toThrow(DuplicateAdapterError);
  });

  it('capability spoofing: mutating the capabilities object after registration does not change registry state', () => {
    const registry = new ProtocolRegistry();
    const metadata = registry.register(makeAdapter());
    const before = metadata.capabilityHash;
    expect(() => {
      (metadata.capabilities as { batchingSupport: boolean }).batchingSupport = true;
    }).toThrow();
    expect(registry.lookupMetadata('blend').capabilityHash).toBe(before);
  });

  it('health spoofing: registry never trusts a cached/static health value — always calls the live adapter', async () => {
    let calls = 0;
    const registry = new ProtocolRegistry();
    registry.register(makeAdapter({ onHealth: () => { calls++; return 'UNAVAILABLE'; } }));
    await registry.health('blend');
    await registry.health('blend');
    expect(calls).toBe(2); // never memoized/spoofed by the registry itself
  });

  it('malformed metadata: an adapter whose capabilities() throws is rejected at registration, not later', () => {
    const registry = new ProtocolRegistry();
    const adapter = makeAdapter();
    (adapter as { capabilities: () => ProtocolCapabilities }).capabilities = () => {
      throw new Error('boom');
    };
    expect(() => registry.register(adapter)).toThrow(MalformedAdapterError);
  });

  it('registry corruption: list() returns a snapshot — pushing to it does not add a phantom adapter', () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAdapter());
    const list = registry.list();
    expect(() => (list as unknown[]).push({} as never)).toThrow();
    expect(registry.list()).toHaveLength(1);
  });
});

// ── Performance ───────────────────────────────────────────────────────────────────────────────

describe('performance', () => {
  it('registration latency stays well under 5ms per call, averaged over 500 registrations', () => {
    const registry = new ProtocolRegistry();
    const t0 = performance.now();
    for (let i = 0; i < 500; i++) {
      const protocol = `perf-${i}`;
      registry.register(makeAdapter({ protocol, capabilities: makeCapabilities({ protocol } as Partial<ProtocolCapabilities>) }));
    }
    const avg = (performance.now() - t0) / 500;
    expect(avg).toBeLessThan(5);
  });

  it('lookup latency stays well under 1ms per call, averaged over 1000 lookups', () => {
    const registry = new ProtocolRegistry();
    registry.register(makeAdapter());
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) registry.lookup('blend');
    const avg = (performance.now() - t0) / 1000;
    expect(avg).toBeLessThan(1);
  });

  it('simulation latency stays well under 5ms per call, averaged over 500 simulations', async () => {
    const adapter = makeAdapter();
    const t0 = performance.now();
    for (let i = 0; i < 500; i++) await adapter.simulate(req);
    const avg = (performance.now() - t0) / 500;
    expect(avg).toBeLessThan(5);
  });
});
