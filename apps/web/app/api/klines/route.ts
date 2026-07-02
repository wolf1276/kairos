import { NextResponse } from 'next/server';
import { BinanceOracle } from '@/oracle';

// Live candle proxy for price charts.
// GET /api/klines?symbol=BTCUSDT&interval=1h&limit=120

const VALID_INTERVALS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const symbol = (searchParams.get('symbol') || 'BTCUSDT').toUpperCase();
        const interval = searchParams.get('interval') || '1h';
        const limit = Math.min(Number(searchParams.get('limit')) || 120, 500);

        if (!VALID_INTERVALS.includes(interval)) {
            return NextResponse.json(
                { error: `Invalid interval. Valid: ${VALID_INTERVALS.join(', ')}` },
                { status: 400 }
            );
        }

        const oracle = new BinanceOracle();
        const candles = await oracle.getCandles(symbol, interval, limit);

        return NextResponse.json(candles, {
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return NextResponse.json(
            { error: message || 'Failed to fetch candles' },
            { status: 502 }
        );
    }
}
