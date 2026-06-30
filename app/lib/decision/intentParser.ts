import { TradingProfile } from './types';

export interface IntentParseInput {
    text: string;
    riskTolerance?: 'LOW' | 'MODERATE' | 'HIGH';
    investmentHorizon?: 'SHORT' | 'MEDIUM' | 'LONG';
    allowedAssets?: string[];
    dailyLimit?: number;
    dailyTradeLimit?: number;
    maxPositionSize?: number;
    stopLossPreference?: number;
    takeProfitPreference?: number;
}

export interface ParseResult {
    status: 'COMPLETE' | 'NEEDS_USER_INPUT';
    missingFields?: string[];
    extracted: {
        goal?: string;
        riskTolerance?: 'LOW' | 'MODERATE' | 'HIGH';
        investmentHorizon?: 'SHORT' | 'MEDIUM' | 'LONG';
        allowedAssets?: string[];
        dailyLimit?: number;
        dailyTradeLimit?: number;
        maxPositionSize?: number;
        stopLossPreference?: number;
        takeProfitPreference?: number;
    };
    profile?: TradingProfile;
}

export function parseIntent(input: IntentParseInput): ParseResult {
    const text = input.text || '';
    
    // 1. Extract Goal (default to the input text if no specific goal format matches)
    let goal = text.trim();
    if (goal.length > 100) {
        goal = goal.substring(0, 97) + '...';
    }

    // 2. Extract Risk Tolerance
    let riskTolerance: 'LOW' | 'MODERATE' | 'HIGH' | undefined = input.riskTolerance;
    if (!riskTolerance) {
        if (/low(\s|-)?risk|conservative|preserve capital/i.test(text)) {
            riskTolerance = 'LOW';
        } else if (/high(\s|-)?risk|aggressive|grow/i.test(text)) {
            riskTolerance = 'HIGH';
        } else if (/moderate(\s|-)?risk|moderate|medium|passive/i.test(text)) {
            riskTolerance = 'MODERATE';
        }
    }

    // 3. Extract Investment Horizon
    let investmentHorizon: 'SHORT' | 'MEDIUM' | 'LONG' | undefined = input.investmentHorizon;
    if (!investmentHorizon) {
        if (/short(\s|-)?term|days|weeks|quick|fast/i.test(text)) {
            investmentHorizon = 'SHORT';
        } else if (/medium(\s|-)?term|months|moderate/i.test(text)) {
            investmentHorizon = 'MEDIUM';
        } else if (/long(\s|-)?term|years|hodl|passive/i.test(text)) {
            investmentHorizon = 'LONG';
        }
    }

    // 4. Extract Allowed Assets
    let allowedAssets: string[] | undefined = input.allowedAssets;
    if (!allowedAssets || allowedAssets.length === 0) {
        const assets: string[] = [];
        const matches = text.match(/\b(XLM|BTC|ETH|USDT|SOL|ADA|XRP)\b/gi);
        if (matches) {
            matches.forEach(m => {
                const upper = m.toUpperCase();
                if (!assets.includes(upper)) {
                    assets.push(upper);
                }
            });
        }
        if (assets.length > 0) {
            allowedAssets = assets;
        }
    }

    // 5. Extract Daily Trade Limit / Daily Limit
    let dailyLimit: number | undefined = input.dailyLimit !== undefined ? input.dailyLimit : input.dailyTradeLimit;
    if (dailyLimit === undefined) {
        // Look for number patterns followed/preceded by limit/daily/per day/max
        const limitMatch = text.match(/(?:limit|max|daily|trade)\s*(?:of\s*)?\$?(\d+(?:\.\d+)?)/i) ||
                           text.match(/\$?(\d+(?:\.\d+)?)\s*(?:limit|max|daily|per day)/i);
        if (limitMatch) {
            dailyLimit = parseFloat(limitMatch[1]);
        }
    }

    // Extracted values so far
    const extracted: ParseResult['extracted'] = {
        goal: goal || undefined,
        riskTolerance,
        investmentHorizon,
        allowedAssets,
        dailyLimit,
        dailyTradeLimit: dailyLimit,
        maxPositionSize: input.maxPositionSize,
        stopLossPreference: input.stopLossPreference,
        takeProfitPreference: input.takeProfitPreference
    };

    // Determine missing fields (based on product requirements: riskTolerance, investmentHorizon, allowedAssets, dailyLimit)
    const missingFields: string[] = [];
    if (!riskTolerance) missingFields.push('riskTolerance');
    if (!investmentHorizon) missingFields.push('investmentHorizon');
    if (!allowedAssets || allowedAssets.length === 0) missingFields.push('allowedAssets');
    if (dailyLimit === undefined || isNaN(dailyLimit)) missingFields.push('dailyLimit');

    if (missingFields.length > 0) {
        return {
            status: 'NEEDS_USER_INPUT',
            missingFields,
            extracted
        };
    }

    // Construct the completed TradingProfile
    const profile: TradingProfile = {
        goal: goal || 'Autonomous Intent-Based Execution',
        riskTolerance: riskTolerance!,
        investmentHorizon: investmentHorizon!,
        allowedAssets: allowedAssets!,
        dailyTradeLimit: dailyLimit!,
        maxPositionSize: input.maxPositionSize || (dailyLimit! * 0.5),
        stopLossPreference: input.stopLossPreference || 2.0, // 2% default
        takeProfitPreference: input.takeProfitPreference || 6.0 // 6% default
    };

    return {
        status: 'COMPLETE',
        extracted,
        profile
    };
}
