import { NextResponse } from 'next/server';
import { PaperTradingEngine } from '@/lib/paper-trading';

export async function GET() {
    try {
        const engine = new PaperTradingEngine();
        const trades = engine.getTradeHistory();
        return NextResponse.json(trades);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return NextResponse.json(
            { error: errorMessage || 'Failed to fetch trade history' },
            { status: 500 }
        );
    }
}
