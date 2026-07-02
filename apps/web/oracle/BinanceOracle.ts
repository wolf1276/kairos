import axios, { AxiosInstance } from 'axios';
import { PriceResponse, TickerResponse, Candle, RawCandle, MarketSnapshot } from './types';
import { IndicatorEngine } from './IndicatorEngine';

const REQUEST_INTERVAL_MS = 1000;
const MAX_CANDLES = 500;
const CACHE_TTL = 30_000;

type CacheEntry = { data: unknown; expiry: number };
const responseCache = new Map<string, CacheEntry>();

export class BinanceOracle {
    private readonly client: AxiosInstance;
    private lastRequestTime = 0;
    private timeframe: string;

    constructor(timeframe?: string) {
        this.client = axios.create({
            baseURL: 'https://api.binance.com/api/v3',
            timeout: 10000,
        });
        this.timeframe = timeframe || '1m';
    }

    setTimeframe(interval: string): void {
        const valid = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '1w'];
        if (!valid.includes(interval)) {
            throw new Error(`Invalid timeframe: ${interval}. Valid: ${valid.join(', ')}`);
        }
        this.timeframe = interval;
    }

    private async rateLimit(): Promise<void> {
        const now = Date.now();
        const elapsed = now - this.lastRequestTime;
        if (elapsed < REQUEST_INTERVAL_MS) {
            await new Promise(resolve => setTimeout(resolve, REQUEST_INTERVAL_MS - elapsed));
        }
        this.lastRequestTime = Date.now();
    }

    private handleError(error: unknown, context: string): never {
        if (axios.isAxiosError(error)) {
            const status = error.response?.status;
            const binanceMessage = error.response?.data && typeof error.response.data === 'object' && 'msg' in error.response.data
                ? (error.response.data as { msg: string }).msg
                : undefined;
            const message = binanceMessage || error.message;
            throw new Error(`BinanceOracle.${context} failed${status ? ` with status ${status}` : ''}: ${message}`);
        }
        if (error instanceof Error) {
            throw new Error(`BinanceOracle.${context} failed: ${error.message}`);
        }
        throw new Error(`BinanceOracle.${context} failed with an unknown error`);
    }

    async getPrice(symbol: string): Promise<PriceResponse> {
        if (!symbol) {
            throw new Error('BinanceOracle.getPrice: symbol is required');
        }
        const cacheKey = `price:${symbol}`;
        const cached = responseCache.get(cacheKey);
        if (cached && Date.now() < cached.expiry) return cached.data as PriceResponse;

        return this.fetchWithRetry(async () => {
            await this.rateLimit();
            const response = await this.client.get<PriceResponse>('/ticker/price', {
                params: { symbol: symbol.toUpperCase() }
            });
            responseCache.set(cacheKey, { data: response.data, expiry: Date.now() + CACHE_TTL });
            return response.data;
        }, `getPrice(${symbol})`);
    }

    async getTicker(symbol: string): Promise<TickerResponse> {
        if (!symbol) {
            throw new Error('BinanceOracle.getTicker: symbol is required');
        }
        const cacheKey = `ticker:${symbol}`;
        const cached = responseCache.get(cacheKey);
        if (cached && Date.now() < cached.expiry) return cached.data as TickerResponse;

        return this.fetchWithRetry(async () => {
            await this.rateLimit();
            const response = await this.client.get<TickerResponse>('/ticker/24hr', {
                params: { symbol: symbol.toUpperCase() }
            });
            responseCache.set(cacheKey, { data: response.data, expiry: Date.now() + CACHE_TTL });
            return response.data;
        }, `getTicker(${symbol})`);
    }

    private async fetchWithRetry<T>(fn: () => Promise<T>, context: string): Promise<T> {
        const maxAttempts = 2;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await fn();
            } catch (error) {
                if (attempt === maxAttempts) {
                    this.handleError(error, context);
                }
                await new Promise(r => setTimeout(r, 500 * attempt));
            }
        }
        throw new Error(`${context}: exhausted retries`);
    }

    async getCandles(symbol: string, interval?: string, limit?: number): Promise<Candle[]> {
        if (!symbol) {
            throw new Error('BinanceOracle.getCandles: symbol is required');
        }
        const useInterval = interval ?? this.timeframe;
        const useLimit = Math.min(limit ?? 200, MAX_CANDLES);
        const cacheKey = `candles:${symbol}:${useInterval}:${useLimit}`;
        const cached = responseCache.get(cacheKey);
        if (cached && Date.now() < cached.expiry) return cached.data as Candle[];

        return this.fetchWithRetry(async () => {
            await this.rateLimit();
            const response = await this.client.get<RawCandle[]>('/klines', {
                params: {
                    symbol: symbol.toUpperCase(),
                    interval: useInterval,
                    limit: useLimit,
                }
            });
            const candles = response.data.map((c) => ({
                openTime: c[0],
                open: parseFloat(c[1]),
                high: parseFloat(c[2]),
                low: parseFloat(c[3]),
                close: parseFloat(c[4]),
                volume: parseFloat(c[5]),
                closeTime: c[6]
            }));
            responseCache.set(cacheKey, { data: candles, expiry: Date.now() + CACHE_TTL });
            return candles;
        }, `getCandles(${symbol}, ${useInterval}, ${useLimit})`);
    }

    async getMarketSnapshot(symbol: string, interval?: string): Promise<MarketSnapshot> {
        if (!symbol) {
            throw new Error('BinanceOracle.getMarketSnapshot: symbol is required');
        }
        const useInterval = interval ?? this.timeframe;
        try {
            const [priceRes, tickerRes, candlesRes] = await Promise.all([
                this.getPrice(symbol),
                this.getTicker(symbol),
                this.getCandles(symbol, useInterval, 200),
            ]);

            const engine = new IndicatorEngine();
            const indicators = engine.calculate(candlesRes);

            return {
                symbol: symbol.toUpperCase(),
                timestamp: Date.now(),
                source: 'binance',
                price: parseFloat(priceRes.price),
                volume24h: parseFloat(tickerRes.volume),
                change24h: parseFloat(tickerRes.priceChangePercent),
                candles: candlesRes,
                indicators,
            };
        } catch (error) {
            if (error instanceof Error) {
                throw new Error(`BinanceOracle.getMarketSnapshot(${symbol}, ${useInterval}) failed: ${error.message}`);
            }
            throw new Error(`BinanceOracle.getMarketSnapshot(${symbol}, ${useInterval}) failed with an unknown error`);
        }
    }
}
