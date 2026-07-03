export interface DisplayItem {
    label: string;
    value: string;
}

export interface DisplayData {
    title: string;
    summary: DisplayItem[];
}

export function formatValue(key: string, val: unknown): string {
    if (val === undefined || val === null) return '';
    if (typeof val === 'boolean') {
        if (key === 'emergencyStop') {
            return val ? 'Active' : 'Inactive';
        }
        return val ? 'Yes' : 'No';
    }
    if (Array.isArray(val)) {
        return val.join(', ');
    }
    if (typeof val === 'number') {
        if (
            key.toLowerCase().includes('limit') ||
            key.toLowerCase().includes('size') ||
            key.toLowerCase().includes('loss') ||
            key.toLowerCase().includes('profit') ||
            key.toLowerCase().includes('capital')
        ) {
            // Percentages for stopLossPreference and takeProfitPreference
            if (key.toLowerCase().includes('preference')) {
                return `${val}%`;
            }
            return `$${val}`;
        }
        if (key === 'sessionDuration') {
            return `${val} hours`;
        }
        return String(val);
    }
    if (typeof val === 'string') {
        const valUpper = val.toUpperCase();
        if (valUpper === 'LOW') return 'Low';
        if (valUpper === 'MODERATE') return 'Moderate';
        if (valUpper === 'HIGH') return 'High';
        if (valUpper === 'SHORT') return 'Short Term';
        if (valUpper === 'MEDIUM') return 'Medium Term';
        if (valUpper === 'LONG') return 'Long Term';
    }
    return String(val);
}

export function getDisplayForMode(
    mode: 'AI_MANAGED' | 'STRATEGY_MANAGED' | 'AUTONOMOUS_AI' | string,
    config: Record<string, unknown> | null | undefined
): DisplayData {
    if (!config) {
        return {
            title: 'Automation Setup',
            summary: [],
        };
    }
    if (mode === 'AI_MANAGED') {
        const summary: DisplayItem[] = [];

        const order = config['order'] as { side: string; asset: string; quantity: number; triggerComparator: string | null; triggerPrice: number | null } | null | undefined;
        if (order) {
            summary.push({ label: 'Order', value: `${order.side.toUpperCase()} ${order.quantity} ${order.asset}` });
            summary.push({
                label: 'Trigger',
                value: order.triggerPrice
                    ? `Price ${order.triggerComparator === 'lte' ? '<=' : '>='} ${order.triggerPrice}`
                    : 'Immediate',
            });
        }

        const mappings: { key: string; label: string }[] = [
            { key: 'goal', label: 'Investment Goal' },
            { key: 'riskTolerance', label: 'Risk Level' },
            { key: 'investmentHorizon', label: 'Investment Horizon' },
            { key: 'allowedAssets', label: 'Allowed Assets' },
            { key: 'dailyTradeLimit', label: 'Daily Trading Limit' },
            { key: 'dailyLimit', label: 'Daily Trading Limit' },
            { key: 'maxPositionSize', label: 'Maximum Position Size' },
            { key: 'stopLossPreference', label: 'Stop Loss' },
            { key: 'takeProfitPreference', label: 'Take Profit' },
        ];

        for (const map of mappings) {
            if (config[map.key] !== undefined && config[map.key] !== null) {
                // Avoid duplicating Daily Trading Limit if both dailyLimit and dailyTradeLimit exist
                if (map.key === 'dailyLimit' && config['dailyTradeLimit'] !== undefined) {
                    continue;
                }
                summary.push({
                    label: map.label,
                    value: formatValue(map.key, config[map.key]),
                });
            }
        }

        return {
            title: order ? 'Order' : 'Investment Plan',
            summary,
        };
    } else if (mode === 'STRATEGY_MANAGED') {
        const summary: DisplayItem[] = [];
        const strategyName = config['strategyName'];
        if (strategyName) {
            summary.push({ label: 'Strategy Setup', value: String(strategyName) });
        }
        const parameters = config['parameters'];
        if (parameters && typeof parameters === 'object') {
            for (const [k, v] of Object.entries(parameters)) {
                summary.push({ label: k, value: formatValue(k, v) });
            }
        }
        return {
            title: 'Strategy Setup',
            summary,
        };
    } else if (mode === 'AUTONOMOUS_AI') {
        const summary: DisplayItem[] = [];
        const mappings: { key: string; label: string }[] = [
            { key: 'sessionDuration', label: 'Session Duration' },
            { key: 'delegatedCapital', label: 'Delegated Capital' },
            { key: 'maxDailyLoss', label: 'Maximum Daily Loss' },
            { key: 'maxTradeSize', label: 'Maximum Trade Size' },
            { key: 'maxTradesPerDay', label: 'Maximum Trades Per Day' },
            { key: 'allowedAssets', label: 'Allowed Assets' },
            { key: 'allowedProtocols', label: 'Allowed Protocols' },
            { key: 'emergencyStop', label: 'Emergency Stop' },
            { key: 'compoundProfits', label: 'Auto Reinvest Profits' },
        ];

        for (const map of mappings) {
            if (config[map.key] !== undefined && config[map.key] !== null) {
                summary.push({
                    label: map.label,
                    value: formatValue(map.key, config[map.key]),
                });
            }
        }

        return {
            title: 'Autonomous Session',
            summary,
        };
    }

    return {
        title: 'Automation Setup',
        summary: [],
    };
}
