import { NextResponse } from 'next/server';
import { DecisionEngine } from '@/lib/decision';
import { TradingContext } from '@/lib/decision/types';
import { BinanceOracle } from '@/oracle';
import { getDisplayForMode } from '@/lib/decision/displayMapper';

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const symbol = (body.symbol || 'BTCUSDT').toUpperCase();
        const automationMode = body.automationMode || 'AI_MANAGED';
        const delegatedAmount = body.delegatedAmount !== undefined ? Number(body.delegatedAmount) : 1000;
        const balance = body.balance !== undefined ? Number(body.balance) : 10000;
        const address = body.address || 'G_DEFAULT';

        // Retrieve current market snapshot via the BinanceOracle
        const oracle = new BinanceOracle();
        const marketSnapshot = await oracle.getMarketSnapshot(symbol);

        const tradingContext: TradingContext = {
            walletContext: { address, balance },
            marketSnapshot,
            delegationContext: {
                delegatedAddress: address,
                delegatedAmount,
                automationMode,
                tradingProfile: body.tradingProfile,
                strategyConfiguration: body.strategyConfiguration,
                agentConfiguration: body.agentConfiguration
            }
        };

        const decisionEngine = new DecisionEngine();
        const proposal = await decisionEngine.decide(tradingContext);

        // Generate presentation layer config display
        let configToDisplay = null;
        if (automationMode === 'AI_MANAGED') {
            configToDisplay = body.tradingProfile;
        } else if (automationMode === 'STRATEGY_MANAGED') {
            configToDisplay = body.strategyConfiguration;
        } else if (automationMode === 'AUTONOMOUS_AI') {
            configToDisplay = body.agentConfiguration;
        }

        const display = configToDisplay ? getDisplayForMode(automationMode, configToDisplay) : undefined;

        return NextResponse.json({
            ...proposal,
            display
        });
    } catch (error: any) {
        return NextResponse.json(
            { error: error.message || 'Failed to analyze market context' },
            { status: 500 }
        );
    }
}
