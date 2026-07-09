// Step 1 of Agent Creation (agentcreation.md): Natural Language -> Intent Parser (with provider
// failover: Hugging Face -> OpenRouter -> Gemini) -> Validated AgentSpec. Covers: valid goal,
// ambiguous goal, missing information, parser failure, provider fallover on transient failures,
// and validation still being enforced after a fallover. No agent/wallet/delegation creation
// happens anywhere in this flow.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const chatCompletion = vi.fn();
const generateContent = vi.fn();
const fetchMock = vi.fn();

vi.mock('@huggingface/inference', () => ({
  HfInference: vi.fn().mockImplementation(() => ({ chatCompletion })),
}));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: () => ({ generateContent }),
  })),
}));

function hfContent(json: unknown) {
  return { choices: [{ message: { content: JSON.stringify(json) } }] };
}

function openRouterFetchResponse(json: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(json) } }] }),
    text: async () => '',
  };
}

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
  vi.clearAllMocks();
  vi.resetModules();
  vi.stubGlobal('fetch', fetchMock);
  process.env.HUGGINGFACE_API_KEY = 'test-hf-key';
  process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
  process.env.GEMINI_API_KEY = 'test-gemini-key';
});

describe('parseIntent', () => {
  it('returns a validated AgentSpec for a clear, unambiguous goal (primary succeeds)', async () => {
    chatCompletion.mockResolvedValue(hfContent(VALID_SPEC));
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
    expect(fetchMock).not.toHaveBeenCalled();
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('asks clarification when the model reports low confidence on an ambiguous goal', async () => {
    chatCompletion.mockResolvedValue(
      hfContent({
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
    chatCompletion.mockResolvedValue(
      hfContent({
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
    delete process.env.HUGGINGFACE_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const { parseIntent } = await import('../intentParser.js');
    const result = await parseIntent('grow my portfolio');

    expect(result.status).toBe('failed');
    expect(result.spec).toBeNull();
    expect(result.error).toMatch(/no intent-parsing provider is configured/i);
    expect(chatCompletion).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('asks clarification for empty goal text without calling any provider', async () => {
    const { parseIntent } = await import('../intentParser.js');
    const result = await parseIntent('   ');

    expect(result.status).toBe('needs_clarification');
    expect(chatCompletion).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('provider fallover', () => {
    it('falls over to OpenRouter when Hugging Face is rate-limited (429)', async () => {
      chatCompletion.mockRejectedValue(Object.assign(new Error('429 Too Many Requests'), { status: 429 }));
      fetchMock.mockResolvedValue(openRouterFetchResponse(VALID_SPEC));

      const { parseIntent } = await import('../intentParser.js');
      const result = await parseIntent('Maximize yield while keeping risk low');

      expect(result.status).toBe('ok');
      expect(result.spec?.mission).toBe('Yield Optimization');
      expect(fetchMock).toHaveBeenCalled();
    });

    it('falls over to OpenRouter when Hugging Face reports exhausted credits', async () => {
      chatCompletion.mockRejectedValue(new Error('You have insufficient credits to complete this request'));
      fetchMock.mockResolvedValue(openRouterFetchResponse(VALID_SPEC));

      const { parseIntent } = await import('../intentParser.js');
      const result = await parseIntent('Maximize yield while keeping risk low');

      expect(result.status).toBe('ok');
      expect(fetchMock).toHaveBeenCalled();
    });

    it('falls over to OpenRouter when Hugging Face times out', async () => {
      chatCompletion.mockRejectedValue(new Error('The operation was aborted'));
      fetchMock.mockResolvedValue(openRouterFetchResponse(VALID_SPEC));

      const { parseIntent } = await import('../intentParser.js');
      const result = await parseIntent('Maximize yield while keeping risk low');

      expect(result.status).toBe('ok');
      expect(fetchMock).toHaveBeenCalled();
    });

    it('falls over to OpenRouter when Hugging Face returns a malformed response', async () => {
      chatCompletion.mockResolvedValue({ choices: [{ message: { content: 'not json at all' } }] });
      fetchMock.mockResolvedValue(openRouterFetchResponse(VALID_SPEC));

      const { parseIntent } = await import('../intentParser.js');
      const result = await parseIntent('Maximize yield while keeping risk low');

      expect(result.status).toBe('ok');
      expect(fetchMock).toHaveBeenCalled();
    });

    it('does not retry on an invalid API key, but still falls over to the next provider', async () => {
      chatCompletion.mockRejectedValue(Object.assign(new Error('Invalid API key'), { status: 401 }));
      fetchMock.mockResolvedValue(openRouterFetchResponse(VALID_SPEC));

      const { parseIntent } = await import('../intentParser.js');
      const result = await parseIntent('Maximize yield while keeping risk low');

      expect(result.status).toBe('ok');
      // Non-retryable: only one attempt against Hugging Face before moving on.
      expect(chatCompletion).toHaveBeenCalledTimes(1);
    });

    it('falls over to Gemini when both Hugging Face and OpenRouter fail', async () => {
      chatCompletion.mockRejectedValue(Object.assign(new Error('503 Service Unavailable'), { status: 503 }));
      fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}), text: async () => 'Service Unavailable' });
      generateContent.mockResolvedValue({ response: { text: () => JSON.stringify(VALID_SPEC) } });

      const { parseIntent } = await import('../intentParser.js');
      const result = await parseIntent('Maximize yield while keeping risk low');

      expect(result.status).toBe('ok');
      expect(generateContent).toHaveBeenCalled();
    });

    it('returns failure (never a fabricated spec) when every provider fails', async () => {
      chatCompletion.mockRejectedValue(Object.assign(new Error('503 Service Unavailable'), { status: 503 }));
      fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}), text: async () => 'Service Unavailable' });
      generateContent.mockRejectedValue(Object.assign(new Error('503 Service Unavailable'), { status: 503 }));

      const { parseIntent } = await import('../intentParser.js');
      const result = await parseIntent('Maximize yield while keeping risk low');

      expect(result.status).toBe('failed');
      expect(result.spec).toBeNull();
      expect(result.error).toMatch(/every configured provider/i);
    });

    it('still enforces validation (clarification, not fabrication) after falling over to a secondary provider', async () => {
      chatCompletion.mockRejectedValue(Object.assign(new Error('429 Too Many Requests'), { status: 429 }));
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
    });
  });
});
