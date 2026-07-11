// Step 1 of Agent Creation (agentcreation.md): Natural Language -> Intent Parser -> Validated
// AgentSpec. The LLM parse was removed (every free provider is out of daily quota, so the wizard
// hard-blocked); parsing is now a deterministic keyword heuristic that always yields a usable spec.
import { describe, it, expect } from 'vitest';
import { parseIntent } from '../intentParser.js';

describe('parseIntent (deterministic, no LLM)', () => {
  it('asks for clarification only on empty input', async () => {
    const r = await parseIntent('   ');
    expect(r.status).toBe('needs_clarification');
    expect(r.spec).toBeNull();
  });

  it('always produces a spec for any real goal', async () => {
    const r = await parseIntent('Grow my XLM steadily');
    expect(r.status).toBe('ok');
    expect(r.spec).not.toBeNull();
    expect(r.spec!.objective).toBe('Long-term Growth');
    expect(r.spec!.executionStyle).toBe('autonomous');
  });

  it('reads risk, objective, capital, and guided style from keywords', async () => {
    const safe = await parseIntent('Keep it safe and preserve my $500 capital');
    expect(safe.spec!.riskLevel).toBe('conservative');
    expect(safe.spec!.objective).toBe('Capital Preservation');
    expect(safe.spec!.suggestedCapital).toContain('500');

    const guided = await parseIntent('Aggressive yield but ask me before each trade');
    expect(guided.spec!.riskLevel).toBe('aggressive');
    expect(guided.spec!.objective).toBe('Income Generation');
    expect(guided.spec!.executionStyle).toBe('guided');
  });
});
