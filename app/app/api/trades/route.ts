import { NextResponse } from 'next/server';
import { PaperTradingEngine } from '@/lib/paper-trading';

export async function GET() {
    try {
        const engine = new PaperTradingEngine();
        const trades = engine.getTradeHistory();
        return NextResponse.json(trades);
    } catch (error: any) {
        return NextResponse.json(
            { error: error.message || 'Failed to fetch trade history' },
            { status: 500 }
        );
    }
}
