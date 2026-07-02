import { NextResponse } from 'next/server';
import axios from 'axios';

// Live batch ticker proxy → avoids browser CORS / regional blocks on Binance.
// GET /api/prices?symbols=BTCUSDT,ETHUSDT,XLMUSDT

interface Ticker {
    symbol: string;
    price: number;
    change24h: number;
    high24h: number;
    low24h: number;
    volume24h: number;
}

const DEFAULT_SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'XLMUSDT', 'SOLUSDT', 'ADAUSDT', 'XRPUSDT', 'DOGEUSDT',
];

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const raw = searchParams.get('symbols');
        const symbols = (raw ? raw.split(',') : DEFAULT_SYMBOLS)
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean);

        if (symbols.length === 0) {
            return NextResponse.json([], { status: 200 });
        }

        // Binance batch 24hr ticker — a single request for all symbols.
        const encoded = JSON.stringify(symbols);
        const res = await axios.get('https://api.binance.com/api/v3/ticker/24hr', {
            params: { symbols: encoded },
            timeout: 6000,
        });

        const list = Array.isArray(res.data) ? res.data : [res.data];
        const tickers: Ticker[] = list.map((t) => ({
            symbol: t.symbol,
            price: parseFloat(t.lastPrice),
            change24h: parseFloat(t.priceChangePercent),
            high24h: parseFloat(t.highPrice),
            low24h: parseFloat(t.lowPrice),
            volume24h: parseFloat(t.quoteVolume),
        }));

        return NextResponse.json(tickers, {
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return NextResponse.json(
            { error: message || 'Failed to fetch prices' },
            { status: 502 }
        );
    }
}
