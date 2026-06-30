import axios, { AxiosInstance } from 'axios';
import { PriceResponse, TickerResponse, Candle, RawCandle, MarketSnapshot } from './types';
import { IndicatorEngine } from './IndicatorEngine';

export class BinanceOracle {
    private readonly client: AxiosInstance;

    constructor() {
        this.client = axios.create({
            baseURL: 'https://api.binance.com/api/v3',
            timeout: 5000,
        });
    }

    /**
     * Helper to handle and format errors from Axios requests
     */
    private handleError(error: unknown, context: string): never {
        if (axios.isAxiosError(error)) {
            const status = error.response?.status;
            // Binance API returns errors in format: { code: -1121, msg: "Invalid symbol." }
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

    /**
     * Fetches current price for a symbol
     */
    async getPrice(symbol: string): Promise<PriceResponse> {
        if (!symbol) {
            throw new Error('BinanceOracle.getPrice: symbol is required');
        }
        try {
            const response = await this.client.get<PriceResponse>('/ticker/price', {
                params: { symbol: symbol.toUpperCase() }
            });
            return response.data;
        } catch (error) {
            this.handleError(error, `getPrice(${symbol})`);
        }
    }

    /**
     * Fetches 24hr ticker price change statistics for a symbol
     */
    async getTicker(symbol: string): Promise<TickerResponse> {
        if (!symbol) {
            throw new Error('BinanceOracle.getTicker: symbol is required');
        }
        try {
            const response = await this.client.get<TickerResponse>('/ticker/24hr', {
                params: { symbol: symbol.toUpperCase() }
            });
            return response.data;
        } catch (error) {
            this.handleError(error, `getTicker(${symbol})`);
        }
    }

    /**
     * Fetches candle (kline) data for a symbol
     */
    async getCandles(symbol: string, interval?: string, limit?: number): Promise<Candle[]> {
        if (!symbol) {
            throw new Error('BinanceOracle.getCandles: symbol is required');
        }
        try {
            const response = await this.client.get<RawCandle[]>('/klines', {
                params: {
                    symbol: symbol.toUpperCase(),
                    interval: interval ?? '1m',
                    limit: limit ?? 200
                }
            });
            return response.data.map((c) => ({
                openTime: c[0],
                open: parseFloat(c[1]),
                high: parseFloat(c[2]),
                low: parseFloat(c[3]),
                close: parseFloat(c[4]),
                volume: parseFloat(c[5]),
                closeTime: c[6]
            }));
        } catch (error) {
            this.handleError(error, `getCandles(${symbol}, ${interval ?? '1m'}, ${limit ?? 200})`);
        }
    }

    /**
     * Fetches price, ticker, and candles in parallel and calculates indicators,
     * returning a single normalized MarketSnapshot.
     */
    async getMarketSnapshot(symbol: string): Promise<MarketSnapshot> {
        if (!symbol) {
            throw new Error('BinanceOracle.getMarketSnapshot: symbol is required');
        }
        try {
            const [priceRes, tickerRes, candlesRes] = await Promise.all([
                this.getPrice(symbol),
                this.getTicker(symbol),
                this.getCandles(symbol, '1m', 200)
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
                indicators
            };
        } catch (error) {
            if (error instanceof Error) {
                throw new Error(`BinanceOracle.getMarketSnapshot(${symbol}) failed: ${error.message}`);
            }
            throw new Error(`BinanceOracle.getMarketSnapshot(${symbol}) failed with an unknown error`);
        }
    }
}

