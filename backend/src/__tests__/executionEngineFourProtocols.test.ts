// Execution Engine — protocol regression suite (Blend, Soroswap), exercising `executeRoute` for
// each real Protocol Layer adapter. Soroswap has a real `RealTransactionProvider` wired
// (`dataSource: 'real'`, mocked-RPC/offline — see `soroswapRealTransactionBuilder.test.ts` for the
// standalone builder proof). Blend intentionally has none yet — its real `submit(Vec<Request>)`
// entrypoint takes a contract-defined struct this repo has no verified spec for (see
// docs/architecture/REASONING_ENGINE.md's Production Gap Closure section) — so it is asserted to
// correctly fall back to `dataSource: 'synthetic'`, never fabricated.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { rpc, Keypair, Account, SorobanDataBuilder } from '@stellar/stellar-sdk';
import { createSoroswapAdapter, createDeterministicRouterClient as ssRouter, createDeterministicSorobanRpcClient as ssRpc, verifyUnsignedXdr as verifySoroswapXdr } from '../protocolAdapters/soroswap/index.js';
import { createBlendAdapter, createDeterministicBlendPoolClient, createDeterministicSorobanRpcClient as blendRpc } from '../protocolAdapters/blend/index.js';
import { ProtocolRegistry } from '../protocolAdapters/index.js';
import { computeRoute } from '../reasoning/routeEngine/index.js';
import type { RouteRequest } from '../reasoning/routeEngine/index.js';
import { executeRoute, createSoroswapRealTransactionProvider } from '../reasoning/routeExecutionEngine/index.js';
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
  delete process.env.SOROSWAP_ROUTER_CONTRACT_ID_TESTNET;
  delete process.env.BLEND_POOL_CONTRACT_ID_TESTNET;
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
