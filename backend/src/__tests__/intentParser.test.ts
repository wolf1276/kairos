// Step 1 of Agent Creation (agentcreation.md): Natural Language -> Hugging Face Intent Parser ->
// Validated AgentSpec. Covers: valid goal, ambiguous goal, missing information, parser failure,
// HF unavailable. No agent/wallet/delegation creation happens anywhere in this flow.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const chatCompletion = vi.fn();

vi.mock('@huggingface/inference', () => ({
  HfInference: vi.fn().mockImplementation(() => ({ chatCompletion })),
}));

function content(json: unknown) {
  return { choices: [{ message: { content: JSON.stringify(json) } }] };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  process.env.HUGGINGFACE_API_KEY = 'test-key';
});

describe('parseIntent', () => {
  it('returns a validated AgentSpec for a clear, unambiguous goal', async () => {
    chatCompletion.mockResolvedValue(
      content({
        mission: 'Yield Optimization',
        objective: 'Long-term Growth',
        riskLevel: 'balanced',
        suggestedCapital: null,
        executionStyle: 'autonomous',
        confidence: 0.94,
        clarifyingQuestions: [],
      })
    );
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
  });

  it('asks clarification when the model reports low confidence on an ambiguous goal', async () => {
    chatCompletion.mockResolvedValue(
      content({
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
      content({
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

  it('reports failure (not a fabricated spec) when the model returns unparseable JSON on every retry', async () => {
    chatCompletion.mockResolvedValue({ choices: [{ message: { content: 'not json at all' } }] });
    const { parseIntent } = await import('../intentParser.js');
    const result = await parseIntent('grow my portfolio');

    expect(result.status).toBe('failed');
    expect(result.spec).toBeNull();
    expect(result.error).toMatch(/failed/i);
    expect(chatCompletion).toHaveBeenCalledTimes(2);
  });

  it('reports failure without calling Hugging Face when HUGGINGFACE_API_KEY is unset', async () => {
    delete process.env.HUGGINGFACE_API_KEY;
    const { parseIntent } = await import('../intentParser.js');
    const result = await parseIntent('grow my portfolio');

    expect(result.status).toBe('failed');
    expect(result.spec).toBeNull();
    expect(result.error).toMatch(/HUGGINGFACE_API_KEY/);
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it('asks clarification for empty goal text without calling Hugging Face', async () => {
    const { parseIntent } = await import('../intentParser.js');
    const result = await parseIntent('   ');

    expect(result.status).toBe('needs_clarification');
    expect(chatCompletion).not.toHaveBeenCalled();
  });
});
