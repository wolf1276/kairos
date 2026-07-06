import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

function makeMockCandleOverrides(limit: number) {
  const count = Math.min(Math.max(limit, 1), 200);
  return {
    _embedded: {
      records: Array.from({ length: count }, (_, i) => ({
        timestamp: String(Date.now() - (count - 1 - i) * 60_000),
        open: '100',
        high: '101',
        low: '99',
        close: '100.5',
        base_volume: '1000',
      })),
    },
  };
}

// Mock fetch globally so priceHistory never hits Horizon.
// Implementation is set in beforeEach (not at define-time) because vi.restoreAllMocks()
// in afterEach resets the implementation — we re-apply it fresh each test.
let mockFetch: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string) => {
    const parsed = new URL(url);
    const limit = parseInt(parsed.searchParams.get('limit') ?? '50', 10);
    return {
      ok: true,
      json: () => Promise.resolve(makeMockCandleOverrides(limit)),
    };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('priceHistory — getCandles caching behavior', () => {
  it('returns candles from cache on repeated calls within the resolution TTL', async () => {
    const { getCandles } = await import('../priceHistory.js');
    const first = await getCandles('XLM/USDC', 300, 50);
    expect(first.length).toBe(50);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const second = await getCandles('XLM/USDC', 300, 50);
    expect(second).toEqual(first);
    // No additional fetch — cache hit.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('evicts stale entries when resolution TTL expires and re-fetches from Horizon', async () => {
    vi.useFakeTimers();
    const { getCandles } = await import('../priceHistory.js');

    const first = await getCandles('XLM/USDC', 60, 10);
    expect(first.length).toBe(10);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Advance past the resolution TTL (60s) but not the sweep interval.
    await vi.advanceTimersByTimeAsync(60_001);

    const second = await getCandles('XLM/USDC', 60, 10);
    expect(second.length).toBe(10);
    // TTL expired — should have triggered a new fetch.
    expect(mockFetch).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('throws for an unsupported pair', async () => {
    const { getCandles } = await import('../priceHistory.js');
    await expect(getCandles('BTC/USDT', 300, 50)).rejects.toThrow(/Unsupported pair/);
  });
});
