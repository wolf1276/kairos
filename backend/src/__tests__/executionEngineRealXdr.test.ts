// Execution Engine wired to a REAL Soroban transaction/resource provider (Aquarius) — proves
// gaps 1/2 (synthetic transactionXDR/resourceEstimate) are closed end to end through
// `executeRoute`, not just at the standalone builder level (see
// `aquariusRealTransactionBuilder.test.ts` for that). Mocks only the network boundary
// (`rpc.Server.prototype`); route discovery/ranking, transaction building, ScVal encoding, and
// XDR assembly are all real. Simulation/validation/fee-estimation still go through the
// deterministic Aquarius adapter double (real RPC simulation for those is exercised by the
// opt-in `aquariusIntegration.test.ts`), so this suite stays hermetic/offline.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { rpc, Keypair, Account, SorobanDataBuilder } from '@stellar/stellar-sdk';
import { createAquariusAdapter, createDeterministicRouterClient, createDeterministicSorobanRpcClient, verifyUnsignedXdr } from '../protocolAdapters/aquarius/index.js';
import type { AssetPoolRegistry } from '../protocolAdapters/aquarius/index.js';
import { ProtocolRegistry } from '../protocolAdapters/index.js';
import { computeRoute } from '../reasoning/routeEngine/index.js';
import { executeRoute, createAquariusRealTransactionProvider } from '../reasoning/routeExecutionEngine/index.js';
import type { ExecutionPlan } from '../reasoning/executionPlanner/index.js';

const ROUTER_CONTRACT_ID = 'CCEHJJXQE4EBFJWB4KNGTZGAYSOVVLEVWZKACA5ZMUPVXA4EHVUJBD5L';
const XLM_ADDRESS = 'CCQ7NUYOGVFE47FQ42WFFLY3QM45ISZC3WDEI7VNOLBEHDOB7JTIAGLO';
const AQUA_ADDRESS = 'CCABHUCPVFTWD7ND3GCPKJ2YB3HBX6MQYROJFKODHVXQS66BXYGPO634';
const POOL_ID = '9ac7a9cde23ac2ada11105eeaa42e43c2ea8332ca0aa8f41f58d7160274d718e';
const FUTURE_DEADLINE = Math.floor(Date.now() / 1000) + 3600;
const SUPPORTED = ['XLM', 'AQUA'];

const sourcePublicKey = Keypair.random().publicKey();

function mockSuccessfulSimulation() {
  const sorobanData = new SorobanDataBuilder().setResources(1_500_000, 2_048, 512).setResourceFee('50000').build();
  vi.spyOn(rpc.Server.prototype, 'getAccount').mockResolvedValue(new Account(sourcePublicKey, '1'));
  vi.spyOn(rpc.Server.prototype, 'simulateTransaction').mockResolvedValue({
    _parsed: true,
    latestLedger: 1000,
    events: [],
    transactionData: { build: () => sorobanData } as never,
    minResourceFee: '50000',
    result: { auth: [], retval: {} as never },
    cost: { cpuInsns: '1500000', memBytes: '2048' },
  } as never);
}

afterEach(() => {
  vi.restoreAllMocks();
});

function makePlan(): ExecutionPlan {
  return {
    executionId: 'exec-1',
    planHash: 'plan-hash-1',
    version: '1.0.0',
    timestamp: 0,
    steps: [{ stepId: 'step-1', type: 'execute', action: 'SWAP', protocol: 'aquarius', asset: 'XLM', allocation: 0.5, dependsOn: [] }],
    protocolRouting: {},
    assetRouting: {},
    dependencies: {},
    prerequisiteChecks: [],
    rollbackStrategy: [],
    simulationRequests: [],
    estimatedFees: [],
    estimatedSlippage: [],
    expectedBalanceChanges: [],
    expectedStateChanges: [],
    metadata: { plannerVersion: '1.0.0', planHash: 'plan-hash-1', decisionHash: 'd', verificationHash: 'v', stepCount: 1 },
  };
}

const fakeRegistry: AssetPoolRegistry = {
  async listPools() {
    return [{ poolId: POOL_ID, assetA: 'XLM', assetB: 'AQUA', concentratedLiquidity: false }];
  },
  async resolveAddress(assetCode: string) {
    if (assetCode === 'XLM') return XLM_ADDRESS;
    if (assetCode === 'AQUA') return AQUA_ADDRESS;
    throw new Error(`no fake address for '${assetCode}'`);
  },
  async findPool(assetA: string, assetB: string) {
    if ((assetA === 'XLM' && assetB === 'AQUA') || (assetA === 'AQUA' && assetB === 'XLM')) return { poolId: POOL_ID, assetA: 'XLM', assetB: 'AQUA', concentratedLiquidity: false };
    return null;
  },
  async findPoolByIndex(poolIndex: string) {
    return poolIndex === POOL_ID ? { poolId: POOL_ID, assetA: 'XLM', assetB: 'AQUA', concentratedLiquidity: false } : null;
  },
};

describe('executeRoute with a real Aquarius transaction provider', () => {
  function buildRegistryAndProvider() {
    const adapter = createAquariusAdapter({
      supportedAssets: SUPPORTED,
      routerClient: createDeterministicRouterClient({ rates: { 'XLM->AQUA': 0.5 } }),
      sorobanRpcClient: createDeterministicSorobanRpcClient(),
    });
    const registry = new ProtocolRegistry();
    registry.register(adapter);
    const provider = createAquariusRealTransactionProvider({ rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, backendApiBaseUrl: 'https://fake-backend.example' });
    return { registry, provider };
  }

  it('produces a real, verifiable unsigned XDR and real resource estimate, marked dataSource: "real"', async () => {
    process.env.AQUARIUS_ROUTER_CONTRACT_ID_TESTNET = ROUTER_CONTRACT_ID;
    mockSuccessfulSimulation();
    // Override the module-level registry used by createAquariusRealTransactionProvider is not
    // directly injectable, so exercise buildRealAquariusTransaction's contract via the provider by
    // monkey-patching global fetch is unnecessary here — instead verify through the lower-level
    // provider directly built against our fake registry for determinism.
    const { buildRealAquariusTransaction } = await import('../protocolAdapters/aquarius/realTransactionBuilder.js');
    const provider = async (tx: { protocol: string; contractId: string; method: string; args: Record<string, unknown>; network: string }) => {
      if (tx.protocol !== 'aquarius') return { success: false as const, errors: ['wrong protocol'] };
      const detail = await buildRealAquariusTransaction(tx.contractId, tx.method, tx.args, tx.network as 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, registry: fakeRegistry });
      if (!detail.success) return { success: false as const, errors: detail.simulationErrors };
      return { success: true as const, unsignedXdr: detail.unsignedXdr, resourceEstimate: detail.resourceEstimate };
    };

    const { registry } = buildRegistryAndProvider();
    const route = await computeRoute(
      { action: 'SWAP', asset: 'XLM', outputAsset: 'AQUA', amount: '1.000000', network: 'testnet', adapterParams: { trustlineEstablished: true, deadline: FUTURE_DEADLINE, minOutput: '0.01' } },
      registry,
    );
    expect(route.selectedProtocol).toBe('aquarius');

    const result = await executeRoute(makePlan(), route, registry, { realTransactionProviders: { aquarius: provider } });

    expect(result.status).toBe('success');
    expect(result.metadata.dataSource).toBe('real');
    expect(result.transactionXDR).not.toBeNull();
    expect(result.resourceEstimate).toEqual({ cpuInstructions: 1_500_000, diskReadBytes: 2_048, writeBytes: 512, resourceFeeStroops: '50000', transactionSizeBytes: expect.any(Number) });

    // The XDR is real and independently verifiable — invokes the real router contract/method.
    const verified = verifyUnsignedXdr(result.transactionXDR!, 'testnet', ROUTER_CONTRACT_ID, 'swap_chained');
    expect(verified.ok).toBe(true);

    delete process.env.AQUARIUS_ROUTER_CONTRACT_ID_TESTNET;
  });

  it('falls back to the synthetic path (dataSource: "synthetic") when no real provider is registered for the protocol', async () => {
    process.env.AQUARIUS_ROUTER_CONTRACT_ID_TESTNET = ROUTER_CONTRACT_ID;
    const { registry } = buildRegistryAndProvider();
    const route = await computeRoute(
      { action: 'SWAP', asset: 'XLM', outputAsset: 'AQUA', amount: '1.000000', network: 'testnet', adapterParams: { trustlineEstablished: true, deadline: FUTURE_DEADLINE, minOutput: '0.01' } },
      registry,
    );
    const result = await executeRoute(makePlan(), route, registry); // no realTransactionProviders
    expect(result.status).toBe('success');
    expect(result.metadata.dataSource).toBe('synthetic');
    delete process.env.AQUARIUS_ROUTER_CONTRACT_ID_TESTNET;
  });

  it('a real provider reporting simulation failure fails the whole execution closed', async () => {
    process.env.AQUARIUS_ROUTER_CONTRACT_ID_TESTNET = ROUTER_CONTRACT_ID;
    vi.spyOn(rpc.Server.prototype, 'getAccount').mockResolvedValue(new Account(sourcePublicKey, '1'));
    vi.spyOn(rpc.Server.prototype, 'simulateTransaction').mockResolvedValue({ _parsed: true, latestLedger: 1000, events: [], error: 'HostError: invalid contract' } as never);

    const { buildRealAquariusTransaction } = await import('../protocolAdapters/aquarius/realTransactionBuilder.js');
    const provider = async (tx: { protocol: string; contractId: string; method: string; args: Record<string, unknown>; network: string }) => {
      const detail = await buildRealAquariusTransaction(tx.contractId, tx.method, tx.args, tx.network as 'testnet', { rpcUrl: 'https://fake-rpc.example', sourceAccountPublicKey: sourcePublicKey, registry: fakeRegistry });
      if (!detail.success) return { success: false as const, errors: detail.simulationErrors };
      return { success: true as const, unsignedXdr: detail.unsignedXdr, resourceEstimate: detail.resourceEstimate };
    };

    const { registry } = buildRegistryAndProvider();
    const route = await computeRoute(
      { action: 'SWAP', asset: 'XLM', outputAsset: 'AQUA', amount: '1.000000', network: 'testnet', adapterParams: { trustlineEstablished: true, deadline: FUTURE_DEADLINE, minOutput: '0.01' } },
      registry,
    );
    const result = await executeRoute(makePlan(), route, registry, { realTransactionProviders: { aquarius: provider } });
    expect(result.status).toBe('failed');
    expect(result.metadata.failureReason).toBe('malformed_xdr');
    delete process.env.AQUARIUS_ROUTER_CONTRACT_ID_TESTNET;
  });
});
