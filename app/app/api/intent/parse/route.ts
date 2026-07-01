import { NextResponse } from 'next/server';
import { parseIntentWithHf } from '@/lib/decision/hfIntentParser';
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

        // Try Hugging Face-based parsing first (with structured JSON output)
        const hfResult = await parseIntentWithHf(body.text);

        let profile = hfResult.profile;
        let extracted = profile || {};
        let status: string;
        let missingFields: string[] | undefined;

        if (hfResult.status === 'COMPLETE' && profile) {
            status = 'READY';
        } else {
            // Fallback to regex-based parser when HF is unavailable or returns incomplete
            const regexResult = parseIntent({
                text: body.text,
                riskTolerance: body.riskTolerance,
                investmentHorizon: body.investmentHorizon,
                allowedAssets: body.allowedAssets,
                dailyLimit: body.dailyLimit !== undefined ? Number(body.dailyLimit) : undefined,
                maxPositionSize: body.maxPositionSize !== undefined ? Number(body.maxPositionSize) : undefined,
                stopLossPreference: body.stopLossPreference !== undefined ? Number(body.stopLossPreference) : undefined,
                takeProfitPreference: body.takeProfitPreference !== undefined ? Number(body.takeProfitPreference) : undefined,
            });

            status = regexResult.status === 'COMPLETE' ? 'READY' : 'MORE_INFORMATION_REQUIRED';
            missingFields = regexResult.missingFields;
            profile = regexResult.profile;
            extracted = regexResult.extracted;
        }

        const responseData: Record<string, unknown> = {
            status,
            extracted,
        };

        if (missingFields) {
            responseData.requiredInformation = missingFields;
        }

        if (profile) {
            responseData.profile = profile;
        }

        const configToDisplay = (profile || extracted) as Record<string, unknown>;
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
