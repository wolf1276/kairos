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
    fees: number;
}

export interface Portfolio {
    balance: number;
    positions: Position[];
    totalValue: number;
    unrealizedPnL: number;
}

interface WalletState {
    balance: number;
    positions: Position[];
    trades: Trade[];
}

const STORAGE_PREFIX = 'kairos_paper_';
const FEES_RATE = 0.001;
const SLIPPAGE_RATE = 0.0005;

function getStorageKey(address?: string): string {
    return `${STORAGE_PREFIX}${address || 'default'}`;
}

function loadState(address?: string): WalletState {
    if (typeof window === 'undefined') {
        return { balance: 10000, positions: [], trades: [] };
    }
    try {
        const raw = localStorage.getItem(getStorageKey(address));
        if (raw) {
            const parsed = JSON.parse(raw);
            return {
                balance: parsed.balance ?? 10000,
                positions: parsed.positions ?? [],
                trades: parsed.trades ?? [],
            };
        }
    } catch {}
    return { balance: 10000, positions: [], trades: [] };
}

function saveState(address: string | undefined, state: WalletState): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(getStorageKey(address), JSON.stringify(state));
    } catch {}
}

export class PaperTradingEngine {
    private address?: string;
    private state: WalletState;

    constructor(address?: string) {
        this.address = address;
        this.state = loadState(address);
    }

    private persist(): void {
        saveState(this.address, this.state);
    }

    setBalance(amount: number): void {
        this.state.balance = amount;
        this.persist();
    }

    getBalance(): number {
        return this.state.balance;
    }

    buy(symbol: string, amount: number, price: number): Trade {
        const uSymbol = symbol.toUpperCase();
        const cost = amount * price;
        const fee = cost * FEES_RATE;
        const totalCost = cost + fee;

        if (this.state.balance < totalCost) {
            throw new Error(`Insufficient virtual balance. Required: $${totalCost.toFixed(2)} (incl. fees), Available: $${this.state.balance.toFixed(2)}`);
        }

        this.state.balance -= totalCost;

        const existing = this.state.positions.find(p => p.symbol === uSymbol);
        if (existing) {
            const newAmount = existing.amount + amount;
            const newEntryPrice = (existing.amount * existing.entryPrice + cost) / newAmount;
            existing.amount = newAmount;
            existing.entryPrice = Number(newEntryPrice.toFixed(4));
        } else {
            this.state.positions.push({
                symbol: uSymbol,
                amount,
                entryPrice: price,
                timestamp: Date.now(),
            });
        }

        const trade: Trade = {
            id: `trade_${Math.random().toString(36).substr(2, 9)}`,
            symbol: uSymbol,
            action: 'BUY',
            amount,
            price,
            timestamp: Date.now(),
            fees: Number(fee.toFixed(4)),
        };

        this.state.trades.unshift(trade);
        this.persist();
        return trade;
    }

    sell(symbol: string, amount: number, price: number): Trade {
        const uSymbol = symbol.toUpperCase();
        const existing = this.state.positions.find(p => p.symbol === uSymbol);

        if (!existing || existing.amount < amount) {
            throw new Error(`Insufficient position. Holding: ${existing?.amount ?? 0} ${uSymbol}, Requested to sell: ${amount}`);
        }

        const revenue = amount * price;
        const fee = revenue * FEES_RATE;
        const slippage = revenue * SLIPPAGE_RATE;
        const netRevenue = revenue - fee - slippage;
        const costBasis = amount * existing.entryPrice;
        const pnl = netRevenue - costBasis;

        this.state.balance += netRevenue;

        const remainingAmount = existing.amount - amount;
        if (remainingAmount <= 0) {
            const idx = this.state.positions.findIndex(p => p.symbol === uSymbol);
            if (idx >= 0) this.state.positions.splice(idx, 1);
        } else {
            existing.amount = remainingAmount;
        }

        const trade: Trade = {
            id: `trade_${Math.random().toString(36).substr(2, 9)}`,
            symbol: uSymbol,
            action: 'SELL',
            amount,
            price,
            timestamp: Date.now(),
            pnl: Number(pnl.toFixed(4)),
            fees: Number(fee.toFixed(4)),
        };

        this.state.trades.unshift(trade);
        this.persist();
        return trade;
    }

    closePosition(symbol: string, price: number): Trade {
        const uSymbol = symbol.toUpperCase();
        const existing = this.state.positions.find(p => p.symbol === uSymbol);
        if (!existing) {
            throw new Error(`No open position found for ${uSymbol}`);
        }
        return this.sell(uSymbol, existing.amount, price);
    }

    getPortfolio(currentPrices?: Record<string, number>): Portfolio {
        let unrealizedPnL = 0;
        let positionsValue = 0;

        for (const pos of this.state.positions) {
            const currentPrice = currentPrices?.[pos.symbol] ?? pos.entryPrice;
            positionsValue += pos.amount * currentPrice;
            unrealizedPnL += pos.amount * (currentPrice - pos.entryPrice);
        }

        return {
            balance: Number(this.state.balance.toFixed(2)),
            positions: [...this.state.positions],
            totalValue: Number((this.state.balance + positionsValue).toFixed(2)),
            unrealizedPnL: Number(unrealizedPnL.toFixed(2)),
        };
    }

    getTradeHistory(): Trade[] {
        return [...this.state.trades];
    }

    calculatePnL(symbol: string, currentPrice: number): number {
        const uSymbol = symbol.toUpperCase();
        const existing = this.state.positions.find(p => p.symbol === uSymbol);
        if (!existing) return 0;
        return Number((existing.amount * (currentPrice - existing.entryPrice)).toFixed(4));
    }

    reset(): void {
        if (typeof window !== 'undefined') {
            try {
                localStorage.removeItem(getStorageKey(this.address));
            } catch {}
        }
        this.state = { balance: 10000, positions: [], trades: [] };
    }
}
