export interface PriceResponse {
    symbol: string;
    price: string;
}

export interface TickerResponse {
    symbol: string;
    priceChange: string;
    priceChangePercent: string;
    weightedAvgPrice: string;
    prevClosePrice: string;
    lastPrice: string;
    lastQty: string;
    bidPrice: string;
    bidQty: string;
    askPrice: string;
    askQty: string;
    openPrice: string;
    highPrice: string;
    lowPrice: string;
    volume: string;
    quoteVolume: string;
    openTime: number;
    closeTime: number;
    firstId: number;
    lastId: number;
    count: number;
}

export interface Candle {
    openTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    closeTime: number;
}

// Raw candle representation returned by Binance API
export type RawCandle = [
    number, // Open time
    string, // Open
    string, // High
    string, // Low
    string, // Close
    string, // Volume
    number, // Close time
    string, // Quote asset volume
    number, // Number of trades
    string, // Taker buy base asset volume
    string, // Taker buy quote asset volume
    string  // Ignore
];

export interface MarketSnapshot {
    symbol: string;
    timestamp: number;
    source: "binance";
    price: number;
    volume24h: number;
    change24h: number;
    candles: Candle[];
    indicators: {
        ema20: number;
        ema50: number;
        sma20: number;
        rsi: number;
        macd: {
            MACD: number;
            signal: number;
            histogram: number;
        };
        atr: number;
    };
}

