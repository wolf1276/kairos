// Fetches OHLC candles for the XLM/USDC pair from Horizon's trade_aggregations endpoint, with
// a small in-memory cache so the scheduler (which ticks far more often than any resolution
// bucket changes) doesn't hammer Horizon on every pass.
import type { Candle } from './strategies/index.js';

const HORIZON_TESTNET_URL = 'https://horizon-testnet.stellar.org';

/** Circle's official testnet USDC issuer (same one used client-side — see
 *  apps/web/app/lib/stellar.ts TESTNET_USDC_ISSUER). Duplicated here since the backend is a
 *  separate deployable service with no dependency on the web app. */
export const TESTNET_USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

interface CacheEntry {
  fetchedAt: number;
  candles: Candle[];
}

const cache = new Map<string, CacheEntry>();

interface TradeAggregationRecord {
  timestamp: string;
  open: string;
  high: string;
  low: string;
  close: string;
  base_volume: string;
}

/**
 * Fetches up to `limit` OHLC candles at `resolutionSeconds` granularity for `pair` (currently
 * only 'XLM/USDC' is supported — base asset is native XLM, counter asset is testnet USDC).
 * Results are cached in-process; a cached response is reused until it's older than one
 * resolution bucket, since Horizon won't have a new completed bucket before then anyway.
 */
export async function getCandles(pair: string, resolutionSeconds: number, limit: number): Promise<Candle[]> {
  const cacheKey = `${pair}:${resolutionSeconds}:${limit}`;
  const cached = cache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < resolutionSeconds * 1000) {
    return cached.candles;
  }

  if (pair !== 'XLM/USDC') {
    throw new Error(`Unsupported pair: ${pair}`);
  }

  const resolutionMs = resolutionSeconds * 1000;
  // Horizon requires resolution to be one of a fixed set of durations (1m/5m/15m/1h/1d etc).
  // Snap up to the nearest supported bucket so arbitrary intervalSeconds values still work.
  const supportedMs = [60_000, 300_000, 900_000, 3_600_000, 86_400_000, 604_800_000];
  const snapped = supportedMs.find((ms) => ms >= resolutionMs) ?? supportedMs[supportedMs.length - 1];

  const endTime = now;
  const startTime = endTime - snapped * limit;

  const url = new URL(`${HORIZON_TESTNET_URL}/trade_aggregations`);
  url.searchParams.set('base_asset_type', 'native');
  url.searchParams.set('counter_asset_type', 'credit_alphanum4');
  url.searchParams.set('counter_asset_code', 'USDC');
  url.searchParams.set('counter_asset_issuer', TESTNET_USDC_ISSUER);
  url.searchParams.set('resolution', String(snapped));
  url.searchParams.set('start_time', String(startTime));
  url.searchParams.set('end_time', String(endTime));
  url.searchParams.set('order', 'asc');
  url.searchParams.set('limit', String(limit));

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Horizon trade_aggregations request failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { _embedded?: { records?: TradeAggregationRecord[] } };
  const records = data._embedded?.records ?? [];

  const candles: Candle[] = records.map((r) => ({
    time: Number(r.timestamp),
    open: parseFloat(r.open),
    high: parseFloat(r.high),
    low: parseFloat(r.low),
    close: parseFloat(r.close),
    volume: parseFloat(r.base_volume),
  }));

  cache.set(cacheKey, { fetchedAt: now, candles });
  return candles;
}

/** Latest close price for a pair — used for unrealized P&L calculations. Falls back to the
 *  most recent cached/fetched candle set at a coarse 5-minute resolution. */
export async function getLatestPrice(pair: string): Promise<number | null> {
  const candles = await getCandles(pair, 300, 50);
  if (candles.length === 0) return null;
  return candles[candles.length - 1].close;
}
