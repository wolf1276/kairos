import { NextResponse } from 'next/server';
import { parseIntent } from '@/lib/decision/intentParser';
import { getDisplayForMode } from '@/lib/decision/displayMapper';

export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        
        if (!body.text) {
            return NextResponse.json(
                { error: 'Text input is required' },
                { status: 400 }
            );
        }

        const parseResult = parseIntent({
            text: body.text,
            riskTolerance: body.riskTolerance,
            investmentHorizon: body.investmentHorizon,
            allowedAssets: body.allowedAssets,
            dailyLimit: body.dailyLimit !== undefined ? Number(body.dailyLimit) : undefined,
            dailyTradeLimit: body.dailyTradeLimit !== undefined ? Number(body.dailyTradeLimit) : undefined,
            maxPositionSize: body.maxPositionSize !== undefined ? Number(body.maxPositionSize) : undefined,
            stopLossPreference: body.stopLossPreference !== undefined ? Number(body.stopLossPreference) : undefined,
            takeProfitPreference: body.takeProfitPreference !== undefined ? Number(body.takeProfitPreference) : undefined,
        });

        // Map internal statuses to user-friendly UI terminology
        const status = parseResult.status === 'COMPLETE' ? 'READY' : 'MORE_INFORMATION_REQUIRED';
        
        const responseData: Record<string, unknown> = {
            status,
            extracted: parseResult.extracted,
        };

        if (parseResult.missingFields) {
            responseData.requiredInformation = parseResult.missingFields;
        }

        if (parseResult.profile) {
            responseData.profile = parseResult.profile;
        }

        // Build presentation data object for frontend direct rendering
        const configToDisplay = (parseResult.profile || parseResult.extracted) as Record<string, unknown>;
        responseData.display = getDisplayForMode('AI_MANAGED', configToDisplay);

        return NextResponse.json(responseData);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return NextResponse.json(
            { error: errorMessage || 'Failed to parse investment intent' },
            { status: 500 }
        );
    }
}
