import { NextResponse } from 'next/server';
import { PaperTradingEngine } from '@/lib/paper-trading';
import { BinanceOracle } from '@/oracle';

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const { action, symbol, address } = body;
        const amount = body.amount !== undefined ? Number(body.amount) : undefined;
        let price = body.price !== undefined ? Number(body.price) : undefined;

        if (!action) {
            return NextResponse.json({ error: 'Action is required' }, { status: 400 });
        }

        const engine = new PaperTradingEngine(address || undefined);

        // Support DEPOSIT to sync available delegated balance or test funding
        if (action === 'DEPOSIT') {
            if (amount === undefined || isNaN(amount) || amount < 0) {
                return NextResponse.json({ error: 'Valid amount is required for deposit' }, { status: 400 });
            }
            engine.setBalance(amount);
            return NextResponse.json({
                success: true,
                balance: engine.getBalance(),
                portfolio: engine.getPortfolio()
            });
        }

        if (!symbol) {
            return NextResponse.json({ error: 'Symbol is required' }, { status: 400 });
        }

        const uSymbol = symbol.toUpperCase();

        // Fetch price if not passed from client
        if (!price) {
            try {
                const oracle = new BinanceOracle();
                const priceRes = await oracle.getPrice(uSymbol);
                price = parseFloat(priceRes.price);
            } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                return NextResponse.json({ error: `Failed to fetch price for ${uSymbol}: ${errMsg}` }, { status: 400 });
            }
        }

        let trade;
        if (action === 'BUY') {
            if (amount === undefined || isNaN(amount) || amount <= 0) {
                return NextResponse.json({ error: 'Valid amount is required for BUY' }, { status: 400 });
            }
            trade = engine.buy(uSymbol, amount, price);
        } else if (action === 'SELL') {
            if (amount === undefined || isNaN(amount) || amount <= 0) {
                return NextResponse.json({ error: 'Valid amount is required for SELL' }, { status: 400 });
            }
            trade = engine.sell(uSymbol, amount, price);
        } else if (action === 'CLOSE') {
            trade = engine.closePosition(uSymbol, price);
        } else {
            return NextResponse.json({ error: 'Invalid action. Supported: BUY, SELL, CLOSE, DEPOSIT' }, { status: 400 });
        }

        return NextResponse.json({
            success: true,
            trade,
            portfolio: engine.getPortfolio()
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return NextResponse.json(
            { error: errorMessage || 'Execution failed' },
            { status: 500 }
        );
    }
}
