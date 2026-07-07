// Deterministic in-memory test double for BlendPoolClient / SorobanRpcClient. NOT a real
// Soroban/Blend integration — exists so the adapter (and its own tests) can be exercised without
// a live network, with fully predictable outputs.
import type { BlendPoolClient, SorobanRpcClient, ReserveData, UserPosition, BlendAction } from './types.js';

export interface DeterministicBlendPoolOptions {
  reserves?: Record<string, ReserveData>;
  positions?: Record<string, UserPosition>;
  defaultHealthFactor?: number;
  /** Health factor a projected BORROW/WITHDRAW should report — lets tests exercise the
   *  adapter's health-factor rejection path deterministically. */
  projectedHealthFactor?: number;
}

const DEFAULT_RESERVE: ReserveData = { asset: 'USDC', supplyAprPct: 4.5, borrowAprPct: 7.2, collateralFactorPct: 80, liabilityFactorPct: 90 };
const DEFAULT_POSITION: UserPosition = { healthFactor: 2.5, totalCollateralUsd: '1000.000000', totalLiabilitiesUsd: '200.000000' };

export function createDeterministicBlendPoolClient(options: DeterministicBlendPoolOptions = {}): BlendPoolClient {
  const reserves = options.reserves ?? {};
  const positions = options.positions ?? {};

  return {
    async getReserveData(asset: string): Promise<ReserveData> {
      return reserves[asset] ?? { ...DEFAULT_RESERVE, asset };
    },
    async getUserPosition(owner: string): Promise<UserPosition> {
      return positions[owner] ?? { ...DEFAULT_POSITION };
    },
    async simulateDeposit(_asset: string, amount: string) {
      return { bTokensMinted: (Number(amount) * 0.999).toFixed(6) };
    },
    async simulateWithdraw(_asset: string, amount: string) {
      return { underlyingReturned: (Number(amount) * 0.999).toFixed(6) };
    },
    async simulateBorrow(_asset: string, amount: string) {
      return { debtTokensMinted: amount };
    },
    async simulateRepay(_asset: string, amount: string) {
      const position = DEFAULT_POSITION;
      const remaining = Math.max(0, Number(position.totalLiabilitiesUsd) - Number(amount));
      return { debtRemaining: remaining.toFixed(6) };
    },
    async projectHealthFactor(owner: string, action: BlendAction) {
      if (options.projectedHealthFactor !== undefined) return options.projectedHealthFactor;
      const position = positions[owner] ?? DEFAULT_POSITION;
      if (action === 'BORROW' || action === 'WITHDRAW') return position.healthFactor - 0.1;
      return position.healthFactor + 0.1;
    },
  };
}

export interface DeterministicSorobanRpcOptions {
  success?: boolean;
  cost?: string;
  errors?: string[];
}

export function createDeterministicSorobanRpcClient(options: DeterministicSorobanRpcOptions = {}): SorobanRpcClient {
  return {
    async simulateTransaction() {
      return { success: options.success ?? true, cost: options.cost ?? '0.000100', result: {}, errors: options.errors ?? [] };
    },
  };
}
