// Execution Engine — four-protocol end-to-end regression suite (Blend, Soroswap, Aquarius,
// Phoenix), exercising `executeRoute` for each real Protocol Layer adapter. Aquarius, Soroswap,
// and Phoenix all have real `RealTransactionProvider`s wired (`dataSource: 'real'`, mocked-RPC/
// offline — see each protocol's own `*RealTransactionBuilder.test.ts` for the standalone builder
// proofs; Aquarius and Soroswap are additionally live-testnet-verified, Phoenix is
// source-verified against the real tagged-release contract code but not live-tested — no public
// deployed Phoenix testnet address could be found). Blend intentionally has none yet — its real
// `submit(Vec<Request>)` entrypoint takes a contract-defined struct this repo has no verified
// spec for (see docs/architecture/REASONING_ENGINE.md's Production Gap Closure section) — so it
// is asserted to correctly fall back to `dataSource: 'synthetic'`, never fabricated.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { rpc, Keypair, Account, SorobanDataBuilder } from '@stellar/stellar-sdk';
import { createAquariusAdapter, createDeterministicRouterClient as aqRouter, createDeterministicSorobanRpcClient as aqRpc, verifyUnsignedXdr as verifyAquariusXdr } from '../protocolAdapters/aquarius/index.js';
import { createSoroswapAdapter, createDeterministicRouterClient as ssRouter, createDeterministicSorobanRpcClient as ssRpc, verifyUnsignedXdr as verifySoroswapXdr } from '../protocolAdapters/soroswap/index.js';
import { createBlendAdapter, createDeterministicBlendPoolClient, createDeterministicSorobanRpcClient as blendRpc } from '../protocolAdapters/blend/index.js';
import { createPhoenixAdapter, createDeterministicMultihopClient, createDeterministicFactoryClient, createDeterministicPoolClient, createDeterministicSorobanRpcClient as phoenixRpc, verifyUnsignedXdr as verifyPhoenixXdr } from '../protocolAdapters/phoenix/index.js';
import { ProtocolRegistry } from '../protocolAdapters/index.js';
import { computeRoute } from '../reasoning/routeEngine/index.js';
import type { RouteRequest } from '../reasoning/routeEngine/index.js';
import { executeRoute, createSoroswapRealTransactionProvider, createPhoenixRealTransactionProvider } from '../reasoning/routeExecutionEngine/index.js';
import type { ExecutionPlan } from '../reasoning/executionPlanner/index.js';

const FUTURE_DEADLINE = Math.floor(Date.now() / 1000) + 3600;
const sourcePublicKey = Keypair.random().publicKey();

function mockSuccessfulSimulation() {
  const sorobanData = new SorobanDataBuilder().setResources(1_000_000, 1_500, 400).setResourceFee('45000').build();
  vi.spyOn(rpc.Server.prototype, 'getAccount').mockResolvedValue(new Account(sourcePublicKey, '1'));
  vi.spyOn(rpc.Server.prototype, 'simulateTransaction').mockResolvedValue({
    _parsed: true,
    latestLedger: 1000,
    events: [],
    transactionData: { build: () => sorobanData } as never,
    minResourceFee: '45000',
    result: { auth: [], retval: {} as never },
    cost: { cpuInsns: '1000000', memBytes: '1500' },
  } as never);
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.AQUARIUS_ROUTER_CONTRACT_ID_TESTNET;
  delete process.env.SOROSWAP_ROUTER_CONTRACT_ID_TESTNET;
  delete process.env.BLEND_POOL_CONTRACT_ID_TESTNET;
  delete process.env.PHOENIX_MULTIHOP_CONTRACT_ID_TESTNET;
  delete process.env.PHOENIX_FACTORY_CONTRACT_ID_TESTNET;
});

function makePlan(protocol: string): ExecutionPlan {
  return {
    executionId: `exec-${protocol}`,
    planHash: `plan-hash-${protocol}`,
    version: '1.0.0',
    timestamp: 0,
    steps: [{ stepId: 'step-1', type: 'execute', action: 'SWAP', protocol, asset: 'XLM', allocation: 0.5, dependsOn: [] }],
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
    metadata: { plannerVersion: '1.0.0', planHash: `plan-hash-${protocol}`, decisionHash: 'd', verificationHash: 'v', stepCount: 1 },
  };
}

function swapRequest(overrides: Partial<RouteRequest> = {}): RouteRequest {
  return {
    action: 'SWAP',
    asset: 'XLM',
    outputAsset: 'USDC',
    amount: '100.000000',
    network: 'testnet',
    adapterParams: { trustlineEstablished: true, deadline: FUTURE_DEADLINE, minOutput: '1' },
    ...overrides,
  };
}

describe('Execution Engine — Aquarius (real)', () => {
  it('produces a real, verifiable unsigned XDR', async () => {
    process.env.AQUARIUS_ROUTER_CONTRACT_ID_TESTNET = 'CCEHJJXQE4EBFJWB4KNGTZGAYSOVVLEVWZKACA5ZMUPVXA4EHVUJBD5L';
    mockSuccessfulSimulation();
    const registry = new ProtocolRegistry();
    registry.register(createAquariusAdapter({ supportedAssets: ['XLM', 'USDC'], routerClient: aqRouter({ rates: { 'XLM->USDC': 0.5 } }), sorobanRpcClient: aqRpc() }));
    const route = await computeRoute(swapRequest(), registry);
    expect(route.selectedProtocol).toBe('aquarius');

    // `createAquariusRealTransactionProvider` builds its own AssetPoolRegistry over HTTP; to keep
    // this suite hermetic/offline, exercise the same real XDR/resource pipeline through
    // `buildRealAquariusTransaction` directly against a fake in-memory registry instead (this is
    // exactly what `createAquariusRealTransactionProvider` does internally, minus the HTTP call).
    const registryMock: AssetPoolRegistryLike = { listPools: async () => [], resolveAddress: async () => 'CCQ7NUYOGVFE47FQ42WFFLY3QM45ISZC3WDEI7VNOLBEHDOB7JTIAGLO', findPool: async () => ({ poolId: 'p', assetA: 'XLM', assetB: 'USDC', concentratedLiquidity: false }), findPoolByIndex: async () => null };
    const { buildRealAquariusTransaction } = await import('../protocolAdapters/aquarius/realTransactionBuilder.js');
    const directProvider = async (tx: { protocol: string; contractId: string; method: string; args: Record<string, unknown>; network: string }) => {
      const detail = await buildRealAquariusTransaction(tx.contractId, tx.method, tx.args, tx.network as 'testnet', { rpcUrl: "https://fake-rpc.example", sourceAccountPublicKey: sourcePublicKey, registry: registryMock });
      if (!detail.success) return { success: false as const, errors: detail.simulationErrors };
      return { success: true as const, unsignedXdr: detail.unsignedXdr, resourceEstimate: detail.resourceEstimate };
    };

    const result = await executeRoute(makePlan('aquarius'), route, registry, { realTransactionProviders: { aquarius: directProvider } });
    expect(result.status).toBe('success');
    expect(result.metadata.dataSource).toBe('real');
    expect(verifyAquariusXdr(result.transactionXDR!, 'testnet', 'CCEHJJXQE4EBFJWB4KNGTZGAYSOVVLEVWZKACA5ZMUPVXA4EHVUJBD5L', 'swap_chained').ok).toBe(true);
  });
});

import type { PoolInfo } from "../protocolAdapters/aquarius/index.js";
interface AssetPoolRegistryLike {
  listPools(): Promise<PoolInfo[]>;
  resolveAddress(assetCode: string): Promise<string>;
  findPool(assetA: string, assetB: string): Promise<{ poolId: string; assetA: string; assetB: string; concentratedLiquidity: boolean } | null>;
  findPoolByIndex(poolIndex: string): Promise<null>;
}

describe('Execution Engine — Soroswap (real)', () => {
  it('produces a real, verifiable unsigned XDR', async () => {
    process.env.SOROSWAP_ROUTER_CONTRACT_ID_TESTNET = 'CCEHJJXQE4EBFJWB4KNGTZGAYSOVVLEVWZKACA5ZMUPVXA4EHVUJBD5L';
    mockSuccessfulSimulation();
    const registry = new ProtocolRegistry();
    registry.register(createSoroswapAdapter({ supportedAssets: ['XLM', 'USDC'], routerClient: ssRouter({ rates: { 'XLM->USDC': 0.5 } }), sorobanRpcClient: ssRpc() }));
    const route = await computeRoute(swapRequest(), registry);
    expect(route.selectedProtocol).toBe('soroswap');

    const provider = createSoroswapRealTransactionProvider({
      rpcUrl: 'https://fake-rpc.example',
      sourceAccountPublicKey: sourcePublicKey,
      assetResolver: { assetIssuers: { USDC: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' } },
    });

    const result = await executeRoute(makePlan('soroswap'), route, registry, { realTransactionProviders: { soroswap: provider } });
    expect(result.status).toBe('success');
    expect(result.metadata.dataSource).toBe('real');
    expect(verifySoroswapXdr(result.transactionXDR!, 'testnet', 'CCEHJJXQE4EBFJWB4KNGTZGAYSOVVLEVWZKACA5ZMUPVXA4EHVUJBD5L', 'swap_exact_tokens_for_tokens').ok).toBe(true);
  });
});

describe('Execution Engine — Blend (synthetic, no verified real ABI yet)', () => {
  it('falls back to synthetic dataSource, never fabricating real XDR', async () => {
    process.env.BLEND_POOL_CONTRACT_ID_TESTNET = 'CBLENDPOOLCONTRACTIDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    const registry = new ProtocolRegistry();
    registry.register(createBlendAdapter({ supportedAssets: ['USDC'], poolClient: createDeterministicBlendPoolClient(), sorobanRpcClient: blendRpc() }));
    const route = await computeRoute({ action: 'LENDING', asset: 'USDC', amount: '100.000000', network: 'testnet', adapterParams: { owner: 'GABCDEOWNERADDRESS', trustlineEstablished: true } }, registry);
    expect(route.selectedProtocol).toBe('blend');
    // No realTransactionProviders entry for 'blend' — must fall back cleanly.
    const result = await executeRoute(makePlan('blend'), route, registry, { realTransactionProviders: {} });
    expect(result.status).toBe('success');
    expect(result.metadata.dataSource).toBe('synthetic');
    expect(result.transactionXDR).not.toBeNull();
    expect(result.resourceEstimate).not.toBeNull();
  });
});

describe('Execution Engine — Phoenix (synthetic fallback, no provider registered)', () => {
  it('falls back to synthetic dataSource, never fabricating real XDR', async () => {
    process.env.PHOENIX_MULTIHOP_CONTRACT_ID_TESTNET = 'CPHOENIXMULTIHOPCONTRACTIDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    process.env.PHOENIX_FACTORY_CONTRACT_ID_TESTNET = 'CPHOENIXFACTORYCONTRACTIDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    const registry = new ProtocolRegistry();
    registry.register(
      createPhoenixAdapter({
        supportedAssets: ['XLM', 'USDC'],
        multihopClient: createDeterministicMultihopClient({ rates: { 'XLM->USDC': 0.5 } }),
        factoryClient: createDeterministicFactoryClient(),
        poolClient: createDeterministicPoolClient(),
        sorobanRpcClient: phoenixRpc(),
      }),
    );
    const route = await computeRoute(swapRequest(), registry);
    expect(route.selectedProtocol).toBe('phoenix');
    const result = await executeRoute(makePlan('phoenix'), route, registry); // no provider configured at all
    expect(result.status).toBe('success');
    expect(result.metadata.dataSource).toBe('synthetic');
  });
});

describe('Execution Engine — Phoenix (real, source-verified)', () => {
  it('produces a real, verifiable unsigned XDR when a real provider is registered', async () => {
    process.env.PHOENIX_MULTIHOP_CONTRACT_ID_TESTNET = 'CCEHJJXQE4EBFJWB4KNGTZGAYSOVVLEVWZKACA5ZMUPVXA4EHVUJBD5L';
    process.env.PHOENIX_FACTORY_CONTRACT_ID_TESTNET = 'CPHOENIXFACTORYCONTRACTIDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    mockSuccessfulSimulation();
    const registry = new ProtocolRegistry();
    registry.register(
      createPhoenixAdapter({
        supportedAssets: ['XLM', 'USDC'],
        multihopClient: createDeterministicMultihopClient({ rates: { 'XLM->USDC': 0.5 } }),
        factoryClient: createDeterministicFactoryClient(),
        poolClient: createDeterministicPoolClient(),
        sorobanRpcClient: phoenixRpc(),
      }),
    );
    const route = await computeRoute(swapRequest(), registry);
    expect(route.selectedProtocol).toBe('phoenix');

    const provider = createPhoenixRealTransactionProvider({
      rpcUrl: 'https://fake-rpc.example',
      sourceAccountPublicKey: sourcePublicKey,
      assetResolver: { assetAddresses: { XLM: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC', USDC: 'CB3TLW74NBIOT3BUWOZ3TUM6RFDF6A4GVIRUQRQZABG5KPOUL4JJOV2F' } },
    });

    const result = await executeRoute(makePlan('phoenix'), route, registry, { realTransactionProviders: { phoenix: provider } });
    expect(result.status).toBe('success');
    expect(result.metadata.dataSource).toBe('real');
    expect(verifyPhoenixXdr(result.transactionXDR!, 'testnet', 'CCEHJJXQE4EBFJWB4KNGTZGAYSOVVLEVWZKACA5ZMUPVXA4EHVUJBD5L', 'swap').ok).toBe(true);
  });
});
