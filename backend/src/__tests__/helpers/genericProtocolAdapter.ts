// Minimal, generic in-memory ProtocolAdapter test double — used only so Route Engine /
// Execution Engine tests can exercise multi-candidate discovery/ranking/rejection logic with
// more than one competing protocol. Not a real integration — Kairos only integrates Blend and
// Soroswap; the protocol id passed in here is an arbitrary test label.
import type { ProtocolAdapter } from '../../protocolAdapters/adapter.js';
import type { AdapterActionRequest, HealthStatus, Quote, SimulationResult, TransactionBuilder } from '../../protocolAdapters/types.js';
import { sha256 } from '../../reasoning/hashing.js';

export interface GenericAdapterOptions {
  rates?: Record<string, number>;
  priceImpactPct?: number;
  health?: HealthStatus;
  supportedActions?: string[];
  supportedAssets?: string[];
}

export function createGenericAdapter(protocol: string, options: GenericAdapterOptions = {}): ProtocolAdapter {
  const rates = options.rates ?? {};
  const priceImpactPct = options.priceImpactPct ?? 0.1;
  const health = options.health ?? 'READY';
  const supportedActions = options.supportedActions ?? ['SWAP', 'CLAIM_REWARDS'];
  const supportedAssets = options.supportedAssets ?? ['XLM', 'USDC', 'AQUA', 'PHO', 'BLND'];

  const rateFor = (from: string, to: string) => rates[`${from}->${to}`] ?? 1;
  const outputAssetFor = (request: AdapterActionRequest) => (request.params?.outputAsset as string) ?? request.asset;

  return {
    protocol,
    version: '1.0.0',
    async initialize() {},
    async health() {
      return health;
    },
    capabilities() {
      return { protocol, supportedActions, supportedAssets, supportedNetworks: ['testnet'], simulationSupport: true, batchingSupport: false, rollbackSupport: false };
    },
    async simulate(request: AdapterActionRequest) {
      const outputAsset = outputAssetFor(request);
      const outputAmount = (Number(request.amount) * rateFor(request.asset, outputAsset)).toFixed(6);
      const base: Omit<SimulationResult, 'simulationHash'> = { success: true, estimatedFees: '0.1', estimatedSlippagePct: priceImpactPct, warnings: [], errors: [], estimatedOutputs: { [outputAsset]: outputAmount } };
      return { ...base, simulationHash: sha256(base) };
    },
    async validate(request: AdapterActionRequest) {
      const errors: string[] = [];
      if (request.action === 'SWAP' || request.action === 'SWAP_CHAINED') {
        if (request.params?.deadline === undefined) errors.push('params.deadline is required for a swap');
        if (request.params?.minOutput === undefined) errors.push('params.minOutput is required for a swap');
        if (request.asset !== 'XLM' && request.params?.trustlineEstablished !== true) errors.push(`trustline required for asset '${request.asset}'`);
      }
      return { ok: errors.length === 0, errors };
    },
    async execute() {
      return { status: 'success' as const, txHash: `${protocol}-tx`, fees: '0.1', durationMs: 1, metadata: {} };
    },
    async estimateFees() {
      return '0.1';
    },
    async estimateSlippage() {
      return priceImpactPct;
    },
    async quote(request: AdapterActionRequest) {
      const outputAsset = outputAssetFor(request);
      const outputAmount = (Number(request.amount) * rateFor(request.asset, outputAsset)).toFixed(6);
      const base: Omit<Quote, 'quoteHash'> = { protocol, action: request.action, inputAsset: request.asset, outputAsset, inputAmount: request.amount, outputAmount, route: [request.asset, outputAsset], priceImpactPct, estimatedFees: '0.1', source: 'on-chain' as const };
      return { ...base, quoteHash: sha256(base) };
    },
    async buildTransaction(request: AdapterActionRequest) {
      const base: Omit<TransactionBuilder, 'transactionHash'> = { protocol, action: request.action, network: request.network, contractId: 'C1', method: 'swap', args: {} };
      return { ...base, transactionHash: sha256(base) };
    },
  };
}
