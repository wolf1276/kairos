// Step 1 of Agent Creation (agentcreation.md): Natural Language -> Intent Parser (with provider
// failover: OpenRouter -> GPT-OSS -> Nvidia -> Gemini) -> Validated AgentSpec. Covers: valid goal,
// ambiguous goal, missing information, parser failure, provider fallover on transient failures,
// and validation still being enforced after a fallover. No agent/wallet/delegation creation
// happens anywhere in this flow.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const generateContent = vi.fn();
const fetchMock = vi.fn();

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: () => ({ generateContent }),
  })),
}));

function openRouterFetchResponse(json: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(json) } }] }),
    text: async () => '',
  };
}

const FAILED_FETCH_RESPONSE = { ok: false, status: 503, json: async () => ({}), text: async () => 'Service Unavailable' };

const VALID_SPEC = {
  mission: 'Yield Optimization',
  objective: 'Long-term Growth',
  riskLevel: 'balanced',
  suggestedCapital: null,
  executionStyle: 'autonomous',
  confidence: 0.94,
  clarifyingQuestions: [],
};

beforeEach(() => {
  // Plain mockReset (not vi.resetAllMocks) — that would also wipe the GoogleGenerativeAI mock's
  // own mockImplementation set once above, breaking getGenerativeModel on every test after the
  // first. Only the two mocks each test reassigns need their queued/once implementations cleared.
  fetchMock.mockReset();
  generateContent.mockReset();
  vi.resetModules();
  vi.stubGlobal('fetch', fetchMock);
  process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
  process.env.GEMINI_API_KEY = 'test-gemini-key';
});

describe('parseIntent', () => {
  it('returns a validated AgentSpec for a clear, unambiguous goal (primary succeeds)', async () => {
    fetchMock.mockResolvedValue(openRouterFetchResponse(VALID_SPEC));
    const { parseIntent } = await import('../intentParser.js');
    const result = await parseIntent('Maximize yield while keeping risk low');

    expect(result.status).toBe('ok');
    expect(result.spec).toEqual({
      mission: 'Yield Optimization',
      objective: 'Long-term Growth',
      riskLevel: 'balanced',
      suggestedCapital: null,
      executionStyle: 'autonomous',
      confidence: 0.94,
    });
    expect(result.clarifyingQuestions).toEqual([]);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('asks clarification when the model reports low confidence on an ambiguous goal', async () => {
    fetchMock.mockResolvedValue(
      openRouterFetchResponse({
        mission: 'Portfolio Manager',
        objective: 'Growth',
        riskLevel: 'balanced',
        suggestedCapital: null,
        executionStyle: 'autonomous',
        confidence: 0.4,
        clarifyingQuestions: ['Do you want to prioritize growth or capital preservation?'],
      })
    );
    const { parseIntent } = await import('../intentParser.js');
    const result = await parseIntent('do something good with my money');

    expect(result.status).toBe('needs_clarification');
    expect(result.spec).toBeNull();
    expect(result.clarifyingQuestions).toContain('Do you want to prioritize growth or capital preservation?');
  });

  it('asks clarification (never fabricates) when a required field is missing', async () => {
    fetchMock.mockResolvedValue(
      openRouterFetchResponse({
        mission: 'Growth Agent',
        objective: null,
        riskLevel: null,
        suggestedCapital: null,
        executionStyle: 'autonomous',
        confidence: 0.9,
        clarifyingQuestions: [],
      })
    );
    const { parseIntent } = await import('../intentParser.js');
    const result = await parseIntent('grow my XLM');

    expect(result.status).toBe('needs_clarification');
    expect(result.spec).toBeNull();
    expect(result.clarifyingQuestions.some((q) => /risk/i.test(q))).toBe(true);
    expect(result.clarifyingQuestions.some((q) => /goal|growth|income|preservation/i.test(q))).toBe(true);
  });

  it('reports failure without calling any provider when no provider is configured', async () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const { parseIntent } = await import('../intentParser.js');
    const result = await parseIntent('grow my portfolio');

    expect(result.status).toBe('failed');
    expect(result.spec).toBeNull();
    expect(result.error).toMatch(/no llm provider is configured/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('asks clarification for empty goal text without calling any provider', async () => {
    const { parseIntent } = await import('../intentParser.js');
    const result = await parseIntent('   ');

    expect(result.status).toBe('needs_clarification');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('provider fallover', () => {
    it('falls over to the next OpenRouter model when the primary is rate-limited (429)', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}), text: async () => 'Too Many Requests' })
        .mockResolvedValueOnce(openRouterFetchResponse(VALID_SPEC));

      const { parseIntent } = await import('../intentParser.js');
      const result = await parseIntent('Maximize yield while keeping risk low');

      expect(result.status).toBe('ok');
      expect(result.spec?.mission).toBe('Yield Optimization');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('falls over to the next OpenRouter model when the primary reports exhausted credits', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 402, json: async () => ({}), text: async () => 'insufficient credits' })
        .mockResolvedValueOnce(openRouterFetchResponse(VALID_SPEC));

      const { parseIntent } = await import('../intentParser.js');
      const result = await parseIntent('Maximize yield while keeping risk low');

      expect(result.status).toBe('ok');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('falls over to the next OpenRouter model when the primary returns a malformed response', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: 'not json at all' } }] }),
          text: async () => '',
        })
        .mockResolvedValueOnce(openRouterFetchResponse(VALID_SPEC));

      const { parseIntent } = await import('../intentParser.js');
      const result = await parseIntent('Maximize yield while keeping risk low');

      expect(result.status).toBe('ok');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('falls over to Gemini when every OpenRouter model fails', async () => {
      fetchMock.mockResolvedValue(FAILED_FETCH_RESPONSE);
      generateContent.mockResolvedValue({ response: { text: () => JSON.stringify(VALID_SPEC) } });

      const { parseIntent } = await import('../intentParser.js');
      const result = await parseIntent('Maximize yield while keeping risk low');

      expect(result.status).toBe('ok');
      expect(generateContent).toHaveBeenCalled();
    });

    it('returns failure (never a fabricated spec) when every provider fails', async () => {
      fetchMock.mockResolvedValue(FAILED_FETCH_RESPONSE);
      generateContent.mockRejectedValue(Object.assign(new Error('503 Service Unavailable'), { status: 503 }));

      const { parseIntent } = await import('../intentParser.js');
      const result = await parseIntent('Maximize yield while keeping risk low');

      expect(result.status).toBe('failed');
      expect(result.spec).toBeNull();
      expect(result.error).toMatch(/every configured llm provider failed/i);
    });

    it('still enforces validation (clarification, not fabrication) after falling over to a secondary provider', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}), text: async () => 'Too Many Requests' })
        .mockResolvedValueOnce(
          openRouterFetchResponse({
            mission: 'Growth Agent',
            objective: null,
            riskLevel: null,
            suggestedCapital: null,
            executionStyle: 'autonomous',
            confidence: 0.9,
            clarifyingQuestions: [],
          })
        );

      const { parseIntent } = await import('../intentParser.js');
      const result = await parseIntent('grow my XLM');

      expect(result.status).toBe('needs_clarification');
      expect(result.spec).toBeNull();
      expect(result.clarifyingQuestions.some((q) => /risk/i.test(q))).toBe(true);
    });
  });
});
