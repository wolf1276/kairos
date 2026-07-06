// Shared request logic for any provider exposing an OpenAI-compatible Chat Completions API
// (OpenAI itself, OpenRouter). One function, parameterized by baseUrl/model/apiKey, so
// OpenAiProvider and OpenRouterProvider never duplicate the HTTP call, structured-output
// request shape, or response parsing.
import { randomUUID } from 'crypto';
import { ProviderError, classifyHttpStatus } from './errors.js';
import { CANDIDATE_DECISION_JSON_SCHEMA } from './schema.js';
import type { Prompt } from '../types.js';
import type { ProviderName, RawProviderResponse } from './types.js';

export function promptToChatMessages(prompt: Prompt): { role: 'system' | 'user'; content: string }[] {
  const s = prompt.sections;
  return [
    { role: 'system', content: s.system },
    {
      role: 'user',
      content: [
        `Agent Identity:\n${s.agentIdentity}`,
        `Current Market Context:\n${s.marketContext}`,
        `Managed Capital:\n${s.managedCapital}`,
        `Historical Experience:\n${s.historicalExperience}`,
        `Detected Patterns:\n${s.detectedPatterns}`,
        `Evidence:\n${s.evidence}`,
        `Risk Constraints:\n${s.riskConstraints}`,
        `Allowed Protocols:\n${s.allowedProtocols}`,
        `Objectives:\n${s.objectives}`,
        `Required Output Schema:\n${s.outputSchema}`,
      ].join('\n\n'),
    },
  ];
}

export interface OpenAiCompatibleRequestParams {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  structuredOutput: boolean;
  prompt: Prompt;
  signal: AbortSignal;
  /** Attributed to any ProviderError raised — the caller's own provider name (`openai`,
   *  `openrouter`, ...), not necessarily the upstream API's name. */
  providerName: ProviderName;
}

/**
 * Performs one Chat Completions round trip against an OpenAI-compatible API. `strict: true` is
 * always set on `json_schema` — without it, Structured Outputs enforcement is best-effort only
 * (an unenforced schema let a live model emit an out-of-range `allocation` and an extra
 * undeclared property in earlier testing).
 */
export async function requestOpenAiCompatibleChatCompletion(params: OpenAiCompatibleRequestParams): Promise<RawProviderResponse> {
  const { baseUrl, apiKey, model, temperature, maxTokens, structuredOutput, prompt, signal, providerName } = params;
  const requestId = randomUUID();
  const body: Record<string, unknown> = {
    model,
    temperature,
    max_tokens: maxTokens,
    messages: promptToChatMessages(prompt),
  };
  if (structuredOutput) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { ...CANDIDATE_DECISION_JSON_SCHEMA, strict: true },
    };
  } else {
    body.response_format = { type: 'json_object' };
  }

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw new ProviderError('timeout', providerName, 'request aborted');
    throw new ProviderError('network', providerName, err instanceof Error ? err.message : String(err));
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ProviderError(classifyHttpStatus(res.status), providerName, `HTTP ${res.status}: ${text}`);
  }

  const json = (await res.json()) as {
    id?: string;
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const content = json.choices?.[0]?.message?.content;
  // Distinct from `invalid_json` (content present but not valid/parseable JSON): an empty
  // completion usually means the routed model produced nothing at all — e.g. wrong modality, a
  // transient upstream hiccup — which retrying (or, for OpenRouter, falling back to a different
  // free model) can plausibly fix. A model that DID respond with malformed content is a
  // model/prompt competency problem retrying can't fix, so that stays non-retryable.
  if (!content) throw new ProviderError('empty_response', providerName, 'no message content in response');

  return {
    raw: content,
    usage: {
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
      totalTokens: json.usage?.total_tokens ?? 0,
    },
    requestId: json.id ?? requestId,
    providerVersion: `${providerName}:${model}`,
  };
}
