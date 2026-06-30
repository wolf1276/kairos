import { NextResponse } from 'next/server';
import { PaperTradingEngine } from '@/lib/paper-trading';
import { BinanceOracle } from '@/oracle';

export async function GET() {
    try {
        const engine = new PaperTradingEngine();
        const portfolio = engine.getPortfolio();
        const currentPrices: Record<string, number> = {};
        const oracle = new BinanceOracle();

        // Retrieve current prices for all open positions in parallel
        await Promise.all(
            portfolio.positions.map(async (pos) => {
                try {
                    const priceRes = await oracle.getPrice(pos.symbol);
                    currentPrices[pos.symbol] = parseFloat(priceRes.price);
                } catch {
                    // Fallback to entry price if Oracle fetch fails
                    currentPrices[pos.symbol] = pos.entryPrice;
                }
            })
        );

        const updatedPortfolio = engine.getPortfolio(currentPrices);
        return NextResponse.json(updatedPortfolio);
    } catch (error: any) {
        return NextResponse.json(
            { error: error.message || 'Failed to fetch portfolio' },
            { status: 500 }
        );
    }
}
