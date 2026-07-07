// Deterministic, stateless replacement for global `fetch`, used only to satisfy Decision
// Intelligence's HTTP call (src/reasoning/decisionIntelligence/requestClient.ts) without any
// real network/LLM call. Every function here is a pure function of its own call — it reads no
// module-level mutable state — so it is safe to install once and reused by hundreds of
// concurrent in-flight requests without cross-request contamination or races.
const VALID_DECISION_OUTPUT = {
  primaryDecision: { action: 'SWAP', protocol: 'soroswap', asset: 'XLM', allocation: 0.1, confidence: 0.75 },
  alternatives: [
    { action: 'REBALANCE', protocol: 'blend', asset: 'XLM', allocation: 0.15, confidence: 0.6, tradeoffs: 'more upside, more risk' },
    { action: 'WITHDRAW', protocol: 'blend', asset: 'USDC', allocation: 0.05, confidence: 0.5, tradeoffs: 'safer but gives up yield' },
  ],
  reasoningChain: [{ step: 'Trend is up per market indicators.', evidenceRefs: [0] }],
  evidence: [{ type: 'market_indicator', source: 'trend', detail: 'ema20 above ema50', weight: 0.6 }],
  risks: [{ description: 'volatility could spike', probability: 0.2, severity: 'low', mitigation: 'monitor and reduce if trend breaks' }],
  assumptions: ['market stays liquid'],
  uncertainty: { missingInformation: [], conflictingEvidence: [], lowConfidenceSignals: [], score: 0.2 },
  expectedOutcome: { direction: 'up', expectedBenefit: 'modest gain if trend continues', expectedDownside: 'small loss if trend reverses' },
  confidence: { overall: 0.75, perSection: { primaryDecision: 0.75, alternatives: 0.6, evidence: 0.7, risk: 0.7, expectedOutcome: 0.65 } },
  summary: 'Hold current position; trend supportive but not strong enough to add.',
};

function okResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function errResponse(status: number, text: string): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => text,
  } as unknown as Response;
}

function openAiPayload(content: unknown): Record<string, unknown> {
  return { id: 'req-e2e', choices: [{ message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 200, completion_tokens: 150, total_tokens: 350 } };
}

export type FaultKind =
  | 'none'
  | 'malformed_json'
  | 'provider_timeout'
  | 'provider_unavailable'
  | 'malformed_protocol_response';

/** Builds a stateless fetch replacement for one fault mode. `AbortSignal` is honored for the
 *  timeout fault so the real orchestrator's own AbortController-based timeout logic fires
 *  exactly as it would against a hung real provider. */
export function makeDeterministicFetch(fault: FaultKind = 'none'): typeof fetch {
  return async (_url: unknown, init?: RequestInit): Promise<Response> => {
    const signal = init?.signal as AbortSignal | undefined;

    if (fault === 'provider_timeout') {
      return new Promise<Response>((_resolve, reject) => {
        if (signal) {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }
        // Never resolves on its own — only the orchestrator's own timeout abort can end this.
      });
    }

    if (fault === 'provider_unavailable') {
      return errResponse(503, 'service unavailable');
    }

    if (fault === 'malformed_json') {
      return okResponse(openAiPayload('{not-valid-json'));
    }

    if (fault === 'malformed_protocol_response') {
      return okResponse({ id: 'req-e2e', choices: [{ message: {} }] });
    }

    return okResponse(openAiPayload(VALID_DECISION_OUTPUT));
  };
}

let previousFetch: typeof fetch | undefined;

export function installFetch(fault: FaultKind = 'none'): void {
  previousFetch = globalThis.fetch;
  globalThis.fetch = makeDeterministicFetch(fault);
}

export function restoreFetch(): void {
  if (previousFetch) globalThis.fetch = previousFetch;
}
