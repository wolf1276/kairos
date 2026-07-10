import { BLEND_TESTNET_ASSETS } from '@wolf1276/kairos-sdk';

const TOKEN_SYMBOLS: Record<string, string> = {
  XLM: BLEND_TESTNET_ASSETS.XLM,
  USDC: BLEND_TESTNET_ASSETS.USDC,
};

export function resolveTokenContractId(symbol: string): string {
  const id = TOKEN_SYMBOLS[symbol];
  if (!id) {
    throw new Error(`No contract ID for token symbol '${symbol}' — only XLM and USDC are currently mapped`);
  }
  return id;
}

export interface SwapRoute {
  path: string[];
  inputSymbol: string;
  outputSymbol: string;
}

export function resolvePairRoute(pair: string, side: 'buy' | 'sell'): SwapRoute {
  const parts = pair.split('/');
  if (parts.length !== 2) {
    throw new Error(`Invalid pair format '${pair}' — expected BASE/QUOTE (e.g. XLM/USDC)`);
  }
  const [base, quote] = parts;
  const path = side === 'buy'
    ? [resolveTokenContractId(quote), resolveTokenContractId(base)]
    : [resolveTokenContractId(base), resolveTokenContractId(quote)];
  return {
    path,
    inputSymbol: side === 'buy' ? quote : base,
    outputSymbol: side === 'buy' ? base : quote,
  };
}

export function computeMinAmountOut(
  amountIn: bigint,
  price: number,
  side: 'buy' | 'sell',
  maxSlippagePct: number
): bigint {
  const amountInDecimal = Number(amountIn) / 1e7;
  let expectedOutDecimal: number;
  if (side === 'buy') {
    expectedOutDecimal = amountInDecimal / price;
  } else {
    expectedOutDecimal = amountInDecimal * price;
  }
  const slippageFactor = 1 - (maxSlippagePct > 0 ? maxSlippagePct : 1) / 100;
  const minOutDecimal = expectedOutDecimal * slippageFactor;
  const minOut = BigInt(Math.floor(minOutDecimal * 1e7));
  return minOut > 0n ? minOut : 1n;
}

export interface SoroswapSwapInput {
  protocolId: 'soroswap';
  action: 'swap';
  path: string[];
  amountIn: bigint;
  minAmountOut: bigint;
  deadline: bigint;
}

export function buildSoroswapSwapRequest(
  pair: string,
  side: 'buy' | 'sell',
  amountIn: bigint,
  price: number,
  maxSlippagePct: number = 1
): SoroswapSwapInput {
  const { path } = resolvePairRoute(pair, side);
  const minAmountOut = computeMinAmountOut(amountIn, price, side, maxSlippagePct);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  return {
    protocolId: 'soroswap',
    action: 'swap',
    path,
    amountIn,
    minAmountOut,
    deadline,
  };
}
