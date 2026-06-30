export interface Position {
    symbol: string;
    amount: number;
    entryPrice: number;
    timestamp: number;
}

export interface Trade {
    id: string;
    symbol: string;
    action: 'BUY' | 'SELL';
    amount: number;
    price: number;
    timestamp: number;
    pnl?: number;
}

export interface Portfolio {
    balance: number;
    positions: Position[];
    totalValue: number;
    unrealizedPnL: number;
}

interface EngineState {
    balance: number;
    positions: Map<string, Position>;
    trades: Trade[];
}

// Preserve state across Next.js hot reloads in development
const globalForPaperTrading = global as unknown as {
    paperTradingState?: EngineState;
};

const defaultState = (): EngineState => ({
    balance: 10000, // Initial virtual balance
    positions: new Map<string, Position>(),
    trades: [],
});

if (!globalForPaperTrading.paperTradingState) {
    globalForPaperTrading.paperTradingState = defaultState();
}

export class PaperTradingEngine {
    private get state(): EngineState {
        return globalForPaperTrading.paperTradingState!;
    }

    setBalance(amount: number): void {
        this.state.balance = amount;
    }

    getBalance(): number {
        return this.state.balance;
    }

    buy(symbol: string, amount: number, price: number): Trade {
        const uSymbol = symbol.toUpperCase();
        const cost = amount * price;

        if (this.state.balance < cost) {
            throw new Error(`Insufficient virtual balance. Required: $${cost.toFixed(2)}, Available: $${this.state.balance.toFixed(2)}`);
        }

        this.state.balance -= cost;

        const existing = this.state.positions.get(uSymbol);
        if (existing) {
            const newAmount = existing.amount + amount;
            const newEntryPrice = (existing.amount * existing.entryPrice + cost) / newAmount;
            this.state.positions.set(uSymbol, {
                symbol: uSymbol,
                amount: newAmount,
                entryPrice: Number(newEntryPrice.toFixed(4)),
                timestamp: Date.now()
            });
        } else {
            this.state.positions.set(uSymbol, {
                symbol: uSymbol,
                amount,
                entryPrice: price,
                timestamp: Date.now()
            });
        }

        const trade: Trade = {
            id: `trade_${Math.random().toString(36).substr(2, 9)}`,
            symbol: uSymbol,
            action: 'BUY',
            amount,
            price,
            timestamp: Date.now()
        };

        this.state.trades.unshift(trade);
        return trade;
    }

    sell(symbol: string, amount: number, price: number): Trade {
        const uSymbol = symbol.toUpperCase();
        const existing = this.state.positions.get(uSymbol);

        if (!existing || existing.amount < amount) {
            throw new Error(`Insufficient position. Holding: ${existing?.amount ?? 0} ${uSymbol}, Requested to sell: ${amount}`);
        }

        const revenue = amount * price;
        const costBasis = amount * existing.entryPrice;
        const pnl = revenue - costBasis;

        this.state.balance += revenue;

        const remainingAmount = existing.amount - amount;
        if (remainingAmount <= 0) {
            this.state.positions.delete(uSymbol);
        } else {
            this.state.positions.set(uSymbol, {
                ...existing,
                amount: remainingAmount
            });
        }

        const trade: Trade = {
            id: `trade_${Math.random().toString(36).substr(2, 9)}`,
            symbol: uSymbol,
            action: 'SELL',
            amount,
            price,
            timestamp: Date.now(),
            pnl: Number(pnl.toFixed(4))
        };

        this.state.trades.unshift(trade);
        return trade;
    }

    closePosition(symbol: string, price: number): Trade {
        const uSymbol = symbol.toUpperCase();
        const existing = this.state.positions.get(uSymbol);
        if (!existing) {
            throw new Error(`No open position found for ${uSymbol}`);
        }
        return this.sell(uSymbol, existing.amount, price);
    }

    getPortfolio(currentPrices?: Record<string, number>): Portfolio {
        const positions = Array.from(this.state.positions.values());
        let unrealizedPnL = 0;
        let positionsValue = 0;

        for (const pos of positions) {
            const currentPrice = currentPrices?.[pos.symbol] ?? pos.entryPrice;
            positionsValue += pos.amount * currentPrice;
            unrealizedPnL += pos.amount * (currentPrice - pos.entryPrice);
        }

        return {
            balance: Number(this.state.balance.toFixed(2)),
            positions,
            totalValue: Number((this.state.balance + positionsValue).toFixed(2)),
            unrealizedPnL: Number(unrealizedPnL.toFixed(2))
        };
    }

    getTradeHistory(): Trade[] {
        return this.state.trades;
    }

    calculatePnL(symbol: string, currentPrice: number): number {
        const uSymbol = symbol.toUpperCase();
        const existing = this.state.positions.get(uSymbol);
        if (!existing) return 0;
        return Number((existing.amount * (currentPrice - existing.entryPrice)).toFixed(4));
    }

    reset(): void {
        globalForPaperTrading.paperTradingState = defaultState();
    }
}
