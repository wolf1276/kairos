import { NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_AGENTS_BACKEND_URL || 'http://localhost:4001';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const symbol = (body.symbol || 'XLM/USDC').toUpperCase();

    const strategiesRes = await fetch(`${BACKEND_URL}/api/strategies`);
    if (!strategiesRes.ok) throw new Error('Backend unavailable');
    const { strategies } = await strategiesRes.json();

    return NextResponse.json({ symbol, strategies, action: 'HOLD', confidence: 1, reasoning: 'Analysis delegated to backend autonomous agents' });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
